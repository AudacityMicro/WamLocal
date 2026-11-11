import ClipperLib from "clipper-lib";
import { MaxRectsPacker } from "maxrects-packer";
import {
  PlacementWorker,
  rotatePolygon,
} from "../vendor/svgnest/placementworker";
import { area, bounds, transformed } from "./geometry";
import type { Part, Point, Project } from "./model";

const S = 10000;
type Path = Point[];
const clip = (p: Path) =>
  p.map((v) => ({ X: Math.round(v.x * S), Y: Math.round(v.y * S) }));
const unclip = (p: any[]) => p.map((v) => ({ x: v.X / S, y: v.Y / S }));
function hull(points: Point[]): Path {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y),
    cross = (a: Point, b: Point, c: Point) =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: Point[] = [],
    upper: Point[] = [];
  for (const p of sorted) {
    while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  for (const p of sorted.reverse()) {
    while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
export function nestingFootprint(part: Part, clearance: number): Path {
  const paths: any[] = [];
  for (const c of transformed({ ...part, x: 0, y: 0 }).filter((c) => !c.hole)) {
    if (c.points.some((p) => Math.abs(p.x) > 1e7 || Math.abs(p.y) > 1e7))
      throw Error("Nesting geometry is outside the supported coordinate range");
    const off = new ClipperLib.ClipperOffset(2, 0.02 * S),
      out: any[] = [];
    const p = area(c.points) < 0 ? [...c.points].reverse() : c.points;
    if (c.closed && clearance === 0) paths.push(clip(p));
    else {
      off.AddPath(
        clip(p),
        ClipperLib.JoinType.jtRound,
        c.closed
          ? ClipperLib.EndType.etClosedPolygon
          : ClipperLib.EndType.etOpenRound,
      );
      off.Execute(out, Math.max(clearance, c.closed ? 0 : 0.01) * S);
      paths.push(...out);
    }
  }
  const union: any[] = [];
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  c.Execute(
    ClipperLib.ClipType.ctUnion,
    union,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  const outlines = union
    .filter((p) => Math.abs(ClipperLib.Clipper.Area(p)) > 1e-6)
    .map(unclip);
  if (!outlines.length) throw Error(`${part.name}: no usable nesting outline`);
  // Disconnected islands stay a single rigid part using a conservative hull.
  const outline = outlines.length === 1 ? outlines[0] : hull(outlines.flat());
  const clean = unclip(
    ClipperLib.Clipper.CleanPolygon(clip(outline), 0.005 * S),
  );
  return area(clean) > 0 ? clean : [...clean].reverse();
}
export function polygonIntersectionArea(a: Path[], b: Path[], evenOdd = false) {
  const ba = bounds(a.flat()),
    bb = bounds(b.flat());
  if (
    ba.x >= bb.x + bb.width ||
    bb.x >= ba.x + ba.width ||
    ba.y >= bb.y + bb.height ||
    bb.y >= ba.y + ba.height
  )
    return 0;
  const c = new ClipperLib.Clipper(),
    out: any[] = [];
  c.AddPaths(a.map(clip), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(b.map(clip), ClipperLib.PolyType.ptClip, true);
  const fill = evenOdd
    ? ClipperLib.PolyFillType.pftEvenOdd
    : ClipperLib.PolyFillType.pftNonZero;
  c.Execute(ClipperLib.ClipType.ctIntersection, out, fill, fill);
  return (
    Math.abs(out.reduce((sum, p) => sum + ClipperLib.Clipper.Area(p), 0)) /
    (S * S)
  );
}
export function partsOverlap(a: Part, b: Part) {
  const closed = (p: Part) =>
    transformed(p)
      .filter((c) => c.closed)
      .map((c) => c.points);
  const ap = closed(a),
    bp = closed(b);
  return ap.length && bp.length
    ? polygonIntersectionArea(ap, bp, true) > 1e-5
    : false;
}
function key(
  a: string | number,
  b: string | number,
  inside: boolean,
  ar: number,
  br: number,
) {
  return JSON.stringify({ A: a, B: b, inside, Arotation: ar, Brotation: br });
}
function minkowski(a: Path, b: Path): Path[] {
  const convex = (p: Path) => {
    let sign = 0;
    for (let i = 0; i < p.length; i++) {
      const u = p[i],
        v = p[(i + 1) % p.length],
        w = p[(i + 2) % p.length];
      const c = (v.x - u.x) * (w.y - v.y) - (v.y - u.y) * (w.x - v.x);
      if (Math.abs(c) < 1e-8) continue;
      if (sign && Math.sign(c) !== sign) return false;
      sign = Math.sign(c);
    }
    return true;
  };
  if (convex(a) && convex(b))
    return [
      hull(
        a.flatMap((p) =>
          b.map((q) => ({ x: p.x - q.x + b[0].x, y: p.y - q.y + b[0].y })),
        ),
      ),
    ];
  const paths = ClipperLib.Clipper.MinkowskiSum(
    clip(a),
    clip(b.map((p) => ({ x: -p.x, y: -p.y }))),
    true,
  );
  if (!paths.length) return [];
  const largest = paths.reduce(
    (best: any[], p: any[]) =>
      Math.abs(ClipperLib.Clipper.Area(p)) >
      Math.abs(ClipperLib.Clipper.Area(best))
        ? p
        : best,
    paths[0],
  );
  const n = unclip(largest).map((p) => ({ x: p.x + b[0].x, y: p.y + b[0].y }));
  return [area(n) > 0 ? n : [...n].reverse()];
}
export type NestingResult = {
  parts: Part[];
  unplaced: Part[];
  provider: string;
};
export function packSheet(
  project: Project,
  allowRotation = true,
  budgetMs = 15000,
): NestingResult {
  if (!project.parts.length)
    return { parts: [], unplaced: [], provider: "SVGnest" };
  const deadline = Date.now() + budgetMs;
  const clearance =
    Math.max(
      ...project.parts.map((p) =>
        Math.max(
          (p.process ?? project.material).kerf / 2,
          (p.process ?? project.material).lead,
        ),
      ),
    ) +
    project.stock.spacing / 2;
  const edge = project.stock.margin - project.stock.spacing / 2;
  const width = project.stock.width - 2 * edge,
    height = project.stock.height - 2 * edge;
  if (width <= 0 || height <= 0) throw Error("Margins leave no usable stock");
  const shapes = project.parts.map((p) => ({
    p,
    polygon: nestingFootprint(p, clearance),
  }));
  const valid = (parts: Part[]) => {
    const footprints = parts.map((p) =>
      nestingFootprint(p, clearance).map((v) => ({
        x: v.x + p.x,
        y: v.y + p.y,
      })),
    );
    return footprints.every((f, i) => {
      const b = bounds(f);
      return (
        b.x >= edge - 1e-4 &&
        b.y >= edge - 1e-4 &&
        b.x + b.width <= project.stock.width - edge + 1e-4 &&
        b.y + b.height <= project.stock.height - edge + 1e-4 &&
        footprints
          .slice(0, i)
          .every((other) => polygonIntersectionArea([f], [other]) < 1e-5)
      );
    });
  };
  // Fast initial candidate; SVGnest handles actual-outline placement below.
  const packer = new MaxRectsPacker(width, height, 0, {
    smart: false,
    pot: false,
    square: false,
    allowRotation,
  });
  packer.addArray(shapes.map((s) => ({ ...bounds(s.polygon), data: s.p.id })));
  if (
    packer.bins.length === 1 &&
    !packer.bins[0].rects.some((r) => r.oversized)
  ) {
    const parts = shapes.map((s) => {
      const r = packer.bins[0].rects.find((r) => r.data === s.p.id)!;
      const p = { ...s.p, rotation: s.p.rotation + (r.rot ? 90 : 0) };
      const b = bounds(nestingFootprint(p, clearance));
      return { ...p, x: r.x + edge - b.x, y: r.y + edge - b.y };
    });
    if (valid(parts))
      return {
        parts,
        unplaced: [],
        provider: "MaxRects + outline verification",
      };
  }
  const bin = [
    { x: edge, y: edge },
    { x: project.stock.width - edge, y: edge },
    { x: project.stock.width - edge, y: project.stock.height - edge },
    { x: edge, y: project.stock.height - edge },
  ];
  const cache: Record<string, Path[]> = {},
    memo = new Map<string, Path[]>();
  const shapeId = (p: Path) =>
    p.map((v) => `${v.x.toFixed(4)},${v.y.toFixed(4)}`).join(";");
  let best: Part[] = [];
  const ordered = [...shapes].sort(
    (a, b) => Math.abs(area(b.polygon)) - Math.abs(area(a.polygon)),
  );
  const attempts = allowRotation ? 12 : 2;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (Date.now() > deadline) break;
    const order = attempt === attempts - 1 ? [...ordered].reverse() : ordered;
    const paths = order.map((s, index) => {
      const base = bounds(s.polygon),
        fits = (b: ReturnType<typeof bounds>) =>
          b.width <= width + 1e-7 && b.height <= height + 1e-7;
      const angle = !allowRotation
        ? 0
        : attempt < 4
          ? 90 * attempt
          : attempt < 8
            ? 90 * ((index + attempt) % 4)
            : 90 * ((index * 3 + attempt) % 4);
      let rotation = angle;
      if (!fits(bounds(rotatePolygon(s.polygon, rotation))) && allowRotation)
        rotation = fits(base) ? 0 : 90;
      const p: any = s.polygon.map((v) => ({ ...v }));
      p.id = s.p.id;
      p.rotation = rotation;
      return p;
    });
    for (let i = 0; i < paths.length; i++) {
      const b = rotatePolygon(paths[i], paths[i].rotation) as Path,
        bb = bounds(b);
      const left = edge - bb.x,
        right = project.stock.width - edge - bb.x - bb.width,
        top = edge - bb.y,
        bottom = project.stock.height - edge - bb.y - bb.height;
      const inside = [
        { x: left + b[0].x, y: top + b[0].y },
        { x: right + b[0].x, y: top + b[0].y },
        { x: right + b[0].x, y: bottom + b[0].y },
        { x: left + b[0].x, y: bottom + b[0].y },
      ];
      cache[key(-1, paths[i].id, true, 0, paths[i].rotation)] =
        right < left - 1e-7 || bottom < top - 1e-7 ? [] : [inside];
      for (let j = 0; j < i; j++) {
        if (Date.now() > deadline) break;
        const a = rotatePolygon(paths[j], paths[j].rotation) as Path,
          signature = shapeId(a) + "|" + shapeId(b);
        if (!memo.has(signature)) memo.set(signature, minkowski(a, b));
        cache[
          key(
            paths[j].id,
            paths[i].id,
            false,
            paths[j].rotation,
            paths[i].rotation,
          )
        ] = memo.get(signature)!;
      }
    }
    if (Date.now() > deadline) break;
    const worker = new PlacementWorker(
      bin,
      paths,
      [],
      [],
      { clipperScale: S },
      cache,
    );
    const result = worker.placePaths(paths);
    const first = result?.placements?.[0] ?? [];
    const parts = first.map((r: any) => {
      const original = project.parts.find((p) => p.id === r.id)!;
      return {
        ...original,
        x: r.x,
        y: r.y,
        rotation: original.rotation + r.rotation,
      };
    });
    if (parts.length > best.length && valid(parts)) best = parts;
    if (best.length === project.parts.length) break;
  }
  return {
    parts: best,
    unplaced: project.parts.filter((p) => !best.some((b) => b.id === p.id)),
    provider: "SVGnest placement worker + Clipper NFP",
  };
}

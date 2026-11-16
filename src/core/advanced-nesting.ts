import Clipper from "clipper-lib";
import { area, bounds, transformed } from "./geometry";
import { polygonIntersectionArea, nestingFootprint } from "./nesting";
import {
  processClearance,
  searchSettings,
  orderParts,
  layoutScore,
} from "./nesting-search";
import type { Part, Point, Project } from "./model";
const S = 10000;
const cp = (p: Point[]) =>
  p.map((v) => ({ X: Math.round(v.x * S), Y: Math.round(v.y * S) }));
const up = (p: any[]) => p.map((v) => ({ x: v.X / S, y: v.Y / S }));
function offset(points: Point[], d: number) {
  const co = new Clipper.ClipperOffset(2, 0.03 * S),
    out: any[] = [];
  co.AddPath(
    cp(area(points) < 0 ? [...points].reverse() : points),
    Clipper.JoinType.jtRound,
    Clipper.EndType.etClosedPolygon,
  );
  co.Execute(out, d * S);
  return out.map(up) as Point[][];
}
function occupied(p: Part, clearance: number, holes: boolean) {
  // Share SVGnest's boundary so different arc approximations cannot
  // invalidate a layout when it becomes a fixed placement in another pass.
  if (!holes)
    return [
      nestingFootprint(p, clearance).map((v) => ({
        x: v.x + p.x,
        y: v.y + p.y,
      })),
    ];
  const paths: Point[][] = [
    nestingFootprint(p, clearance).map((v) => ({ x: v.x + p.x, y: v.y + p.y })),
  ];
  for (const c of transformed(p))
    if (c.closed && c.hole) paths.push(...offset(c.points, -clearance));
  return paths;
}
function outside(paths: Point[][], allowed: Point[][]) {
  const c = new Clipper.Clipper(),
    out: any[] = [];
  c.AddPaths(paths.map(cp), Clipper.PolyType.ptSubject, true);
  c.AddPaths(allowed.map(cp), Clipper.PolyType.ptClip, true);
  c.Execute(
    Clipper.ClipType.ctDifference,
    out,
    Clipper.PolyFillType.pftEvenOdd,
    Clipper.PolyFillType.pftEvenOdd,
  );
  return (
    Math.abs(
      out.reduce((a: number, p: any) => a + Clipper.Clipper.Area(p), 0),
    ) /
      (S * S) >
    0.0001
  );
}
export function rotationAngles(p: Part, step: number, rotate: boolean) {
  if (!rotate || p.rotationPolicy === "fixed") return [p.rotation];
  if (p.rotationPolicy === "grain-x") return [0, 180];
  if (p.rotationPolicy === "grain-y") return [90, 270];
  return Array.from(
    { length: Math.ceil(360 / step) },
    (_, i) => p.rotation + i * step,
  );
}
export function advancedPack(
  project: Project,
  rotate: boolean,
  budgetMs: number,
) {
  const cfg = searchSettings(project.nesting),
    deadline = Date.now() + budgetMs,
    spacing = project.stock.spacing / 2;
  const clearance = (p: Part) => processClearance(p, project);
  const outer = [
    { x: 0, y: 0 },
    { x: project.stock.width, y: 0 },
    { x: project.stock.width, y: project.stock.height },
    { x: 0, y: project.stock.height },
  ];
  const edge = project.stock.margin - spacing;
  const allowed = offset(project.stock.outline ?? outer, -edge).concat(
    ...(project.stock.exclusions ?? []).map((p) => offset(p, edge)),
  );
  const locked = project.parts.filter((p) => p.locked),
    free = project.parts.filter((p) => !p.locked);
  let allowHoles = cfg.insideHoles;
  if (allowHoles) {
    const holeDiagonal = Math.max(
      0,
      ...project.parts.flatMap((p) =>
        p.contours
          .filter((c) => c.hole && c.closed)
          .map((c) => {
            const b = bounds(c.points);
            return Math.hypot(b.width, b.height) * p.scale;
          }),
      ),
    );
    const sizes = new Map<string, number>();
    const minimumSide = Math.min(
      Infinity,
      ...project.parts.map((p) => {
        const key = JSON.stringify([
          p.contours,
          p.scale,
          p.rotationPolicy,
          p.rotation,
        ]);
        let value = sizes.get(key);
        if (value === undefined) {
          value = Math.min(
            ...rotationAngles(p, cfg.rotationStep, rotate).map((rotation) => {
              const b = bounds(
                transformed({ ...p, x: 0, y: 0, rotation })
                  .filter((c) => !c.hole)
                  .flatMap((c) => c.points),
              );
              return Math.min(b.width, b.height);
            }),
          );
          sizes.set(key, value);
        }
        return value;
      }),
    );
    allowHoles = holeDiagonal > 0 && minimumSide <= holeDiagonal + 0.0002;
  }
  const geometryKeys = new Map(
    project.parts.map((p) => [
      p.id,
      JSON.stringify(
        p.contours.map((c) => ({
          points: c.points,
          closed: c.closed,
          hole: c.hole,
        })),
      ),
    ]),
  );
  const cache = new Map<string, Point[][]>();
  const footprints = (p: Part) => {
    const key = [
      geometryKeys.get(p.id),
      p.rotation,
      p.scale,
      clearance(p),
      allowHoles,
    ].join("|");
    let fp = cache.get(key);
    if (!fp) {
      fp = occupied({ ...p, x: 0, y: 0 }, clearance(p), allowHoles);
      cache.set(key, fp);
    }
    return p.x || p.y
      ? fp.map((c) => c.map((v) => ({ x: v.x + p.x, y: v.y + p.y })))
      : fp;
  };
  const overlapsBox = (
    a: ReturnType<typeof bounds>,
    b: ReturnType<typeof bounds>,
  ) =>
    a.x < b.x + b.width - 1e-6 &&
    a.x + a.width > b.x + 1e-6 &&
    a.y < b.y + b.height - 1e-6 &&
    a.y + a.height > b.y + 1e-6;
  const insideStock = (fp: Point[][], b: ReturnType<typeof bounds>) =>
    project.stock.outline || project.stock.exclusions?.length
      ? !outside(fp, allowed)
      : b.x >= edge - 1e-5 &&
        b.y >= edge - 1e-5 &&
        b.x + b.width <= project.stock.width - edge + 1e-5 &&
        b.y + b.height <= project.stock.height - edge + 1e-5;
  const orientationKeys = new WeakMap<Point[][], string>();
  const lockedPaths = locked.map(footprints);
  const lockedBounds = lockedPaths.map((fp) => bounds(fp.flat()));
  for (let i = 0; i < locked.length; i++)
    if (
      !insideStock(lockedPaths[i], lockedBounds[i]) ||
      lockedPaths
        .slice(0, i)
        .some(
          (q, j) =>
            overlapsBox(lockedBounds[i], lockedBounds[j]) &&
            polygonIntersectionArea(lockedPaths[i], q, true) > 1e-5,
        )
    )
      throw Error(
        "Locked placements violate stock bounds or part spacing. Move or unlock them first.",
      );
  const score = (ps: Part[]) => layoutScore(ps, cfg.objective);
  let best = [...locked],
    bestScore = Infinity;
  for (
    let trial = 0;
    Date.now() < deadline && trial < (cfg.optimize ? cfg.restarts : 1);
    trial++
  ) {
    const order = orderParts(free, cfg.order, trial, cfg.seed);
    const placed = [...locked],
      regions = [...lockedPaths],
      regionBounds = [...lockedBounds];
    for (const original of order) {
      let chosen: Part | undefined;
      let chosenScore = Infinity;
      const orientations = new Set<string>();
      const angles = rotationAngles(original, cfg?.rotationStep ?? 90, rotate);
      angles.push(...angles.splice(0, (cfg.seed + trial) % angles.length));
      if (cfg.detail !== "fine") {
        const ranks = new Map(
          angles.map((rotation) => {
            const b = bounds(
              transformed({ ...original, x: 0, y: 0, rotation })
                .filter((c) => !c.hole)
                .flatMap((c) => c.points),
            );
            return [
              rotation,
              cfg.objective === "width"
                ? b.width
                : cfg.objective === "height"
                  ? b.height
                  : b.width * b.height,
            ] as const;
          }),
        );
        angles.sort((a, b) => ranks.get(a)! - ranks.get(b)!);
      }
      for (const angle of angles) {
        if (Date.now() > deadline) break;
        const p = { ...original, x: 0, y: 0, rotation: angle },
          fp = footprints(p),
          b = bounds(fp.flat());
        if (!fp.length) throw Error(`${p.name}: no usable nesting outline`);
        let orientation = orientationKeys.get(fp);
        if (!orientation) {
          const design = transformed(p).filter((c) => allowHoles || !c.hole),
            db = bounds(design.flatMap((c) => c.points));
          orientation = design
            .map((c) =>
              c.points
                .map(
                  (v) =>
                    `${(v.x - db.x).toFixed(5)},${(v.y - db.y).toFixed(5)}`,
                )
                .sort()
                .join(";"),
            )
            .sort()
            .join("|");
          orientationKeys.set(fp, orientation);
        }
        if (orientations.has(orientation)) continue;
        orientations.add(orientation);

        const xs = new Set<number>([
            edge - b.x,
            project.stock.width - edge - b.width - b.x,
            (project.stock.width - b.width) / 2 - b.x,
          ]),
          ys = new Set<number>([
            edge - b.y,
            project.stock.height - edge - b.height - b.y,
            (project.stock.height - b.height) / 2 - b.y,
          ]);
        for (const q of regionBounds) {
          for (const x of [
            q.x - b.width,
            q.x + q.width,
            q.x,
            q.x + (q.width - b.width) / 2,
          ])
            xs.add(x - b.x);
          for (const y of [
            q.y - b.height,
            q.y + q.height,
            q.y,
            q.y + (q.height - b.height) / 2,
          ])
            ys.add(y - b.y);
        }
        if (allowHoles)
          for (const item of placed)
            for (const c of transformed(item))
              if (c.hole) {
                const q = bounds(c.points),
                  pad = clearance(item);
                for (const x of [
                  q.x + pad,
                  q.x + q.width - pad - b.width,
                  q.x + (q.width - b.width) / 2,
                ])
                  xs.add(x - b.x);
                for (const y of [
                  q.y + pad,
                  q.y + q.height - pad - b.height,
                  q.y + (q.height - b.height) / 2,
                ])
                  ys.add(y - b.y);
              }
        const contacts = {
          xx: [...xs].sort((a, b) => a - b),
          yy: [...ys].sort((a, b) => a - b),
        };
        const samples = { coarse: 24, normal: 64, fine: 160 }[cfg.detail];
        const increment = Math.max(
          0.25,
          Math.min(b.width, b.height) / (cfg.detail === "fine" ? 10 : 5),
          Math.max(project.stock.width, project.stock.height) / samples,
        );
        for (
          let x = edge - b.x;
          x <= project.stock.width - edge - b.width - b.x;
          x += increment
        )
          xs.add(x);
        for (
          let y = edge - b.y;
          y <= project.stock.height - edge - b.height - b.y;
          y += increment
        )
          ys.add(y);
        const grid = {
          xx: [...xs].sort((a, b) => a - b),
          yy: [...ys].sort((a, b) => a - b),
        };
        for (const positions of cfg.detail === "fine"
          ? [grid]
          : [contacts, grid]) {
          const xx = [...positions.xx],
            yy = positions.yy;
          if (trial % 2) xx.reverse();
          const primary = cfg.objective === "width" ? xx : yy,
            secondary = cfg.objective === "width" ? yy : xx;
          search: for (const first of primary)
            for (const second of secondary) {
              const x = cfg.objective === "width" ? first : second,
                y = cfg.objective === "width" ? second : first;
              if (Date.now() > deadline) break search;
              const moved = fp.map((c) =>
                c.map((v) => ({ x: v.x + x, y: v.y + y })),
              );
              const movedBounds = { ...b, x: b.x + x, y: b.y + y };
              if (
                !insideStock(moved, movedBounds) ||
                regions.some(
                  (q, j) =>
                    overlapsBox(movedBounds, regionBounds[j]) &&
                    polygonIntersectionArea(moved, q, true) > 1e-5,
                )
              )
                continue;
              const candidate = { ...p, x, y },
                value = score([...placed, candidate]);
              if (value < chosenScore) {
                chosen = candidate;
                chosenScore = value;
              }
              break search;
            }
          if (chosen) break;
        }
        if (chosen && (cfg.effort === "fast" || cfg.detail !== "fine")) break;
      }
      if (chosen) {
        placed.push(chosen);
        regions.push(footprints(chosen));
        regionBounds.push(bounds(regions[regions.length - 1].flat()));
      }
    }
    const value = placed.length ? score(placed) : Infinity;
    if (
      placed.length > best.length ||
      (placed.length === best.length && value < bestScore)
    ) {
      best = placed;
      bestScore = value;
    }
    if (!cfg?.optimize && best.length === project.parts.length) break;
  }
  return {
    parts: best,
    unplaced: project.parts.filter((p) => !best.some((b) => b.id === p.id)),
    provider: "SVGnest geometry / constrained multi-start search",
    timedOut: Date.now() >= deadline,
  };
}

import paper from "paper/dist/paper-core";
import DxfParser from "dxf-parser";
import { makePart, type Contour, type Part, type Point } from "./model";
import { bounds, distance } from "./geometry";
import { flattenDxfPolyline } from "./dxf-polyline";
import { prepareSvg } from "./svg-normalize";
import ClipperLib from "clipper-lib";
function contains(points: Point[], p: Point) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
function finish(name: string, contours: Contour[]): Part {
  if (!contours.length) throw Error("No supported vector geometry found.");
  for (const c of contours)
    c.hole =
      c.closed &&
      contours.filter(
        (other) =>
          other !== c && other.closed && contains(other.points, c.points[0]),
      ).length %
        2 ===
        1;
  const b = bounds(contours.flatMap((c) => c.points));
  return makePart(
    name,
    contours.map((c) => ({
      ...c,
      points: c.points.map((p) => ({ x: p.x - b.x, y: p.y - b.y })),
    })),
  );
}
export function importSvg(source: string, name: string): Part {
  const svg = prepareSvg(source);
  const vb = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const units: Record<string, number> = {
    mm: 1,
    cm: 10,
    in: 25.4,
    px: 25.4 / 96,
    pt: 25.4 / 72,
    pc: 25.4 / 6,
    q: 0.25,
  };
  const physical = (name: string) => {
    const m = (svg.getAttribute(name) ?? "").match(
      /^([\d.eE+-]+)\s*(mm|cm|in|px|pt|pc|q)?$/i,
    );
    return m ? Number(m[1]) * units[(m[2] ?? "px").toLowerCase()] : 0;
  };
  const width = physical("width"),
    height = physical("height");
  let factorX = 25.4 / 96,
    factorY = factorX;
  if (vb?.length === 4 && vb[2] > 0 && vb[3] > 0) {
    factorX = width > 0 ? width / vb[2] : height > 0 ? height / vb[3] : factorX;
    factorY = height > 0 ? height / vb[3] : factorX;
    if (!/none/.test(svg.getAttribute("preserveAspectRatio") ?? ""))
      factorX = factorY = /slice/.test(
        svg.getAttribute("preserveAspectRatio") ?? "",
      )
        ? Math.max(factorX, factorY)
        : Math.min(factorX, factorY);
  }
  const factor = Math.max(factorX, factorY);
  if (vb && vb.length === 4) {
    svg.setAttribute("width", String(width > 0 ? width / factorX : vb[2]));
    svg.setAttribute("height", String(height > 0 ? height / factorY : vb[3]));
  }
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1000, 1000));
  try {
    const root = scope.project.importSVG(svg as unknown as SVGElement, {
      insert: false,
      applyMatrix: true,
      expandShapes: true,
    });
    const contours: Contour[] = [];
    const pointsOf = (path: paper.Path, space: paper.Item = path) => {
      const copy = path.clone({ insert: false });
      copy.flatten(0.08 / factor);
      if (copy.segments.length > 20000)
        throw Error("SVG contour exceeds 20,000 nodes.");
      return copy.segments.map((s) => {
        const p = space.localToGlobal(s.point);
        return { x: p.x * factorX, y: p.y * factorY };
      });
    };
    const visit = (
      item: paper.Item,
      clips: { paths: Point[][]; evenOdd: boolean }[] = [],
    ) => {
      if (item.opacity === 0) return;
      if (item.className === "Shape") {
        const path = (item as paper.Shape).toPath(false);
        if (item.parent) path.transform(item.parent.globalMatrix);
        visit(path, clips);
        return;
      }

      if (item.className === "Path" || item.className === "CompoundPath") {
        const raw =
          item.className === "Path"
            ? [item as paper.Path]
            : ((item as paper.CompoundPath).children as paper.Path[]);
        let paths = raw
          .map((path) => ({
            points: pointsOf(path),
            closed: path.closed,
            hole: false,
          }))
          .filter((p) => p.points.length > 1);
        if (!paths.length) return;
        for (const clip of clips) {
          const engine = new ClipperLib.Clipper(),
            tree = new ClipperLib.PolyTree();
          const scale = (p: Point[]) =>
            p.map((v) => ({
              X: Math.round(v.x * 100000),
              Y: Math.round(v.y * 100000),
            }));
          for (const p of paths)
            engine.AddPath(
              scale(p.points),
              ClipperLib.PolyType.ptSubject,
              p.closed,
            );
          engine.AddPaths(
            clip.paths.map(scale),
            ClipperLib.PolyType.ptClip,
            true,
          );
          engine.Execute(
            ClipperLib.ClipType.ctIntersection,
            tree,
            ClipperLib.PolyFillType.pftEvenOdd,
            clip.evenOdd
              ? ClipperLib.PolyFillType.pftEvenOdd
              : ClipperLib.PolyFillType.pftNonZero,
          );
          paths = [
            ...ClipperLib.Clipper.ClosedPathsFromPolyTree(tree).map(
              (p: any) => ({ p, closed: true }),
            ),
            ...ClipperLib.Clipper.OpenPathsFromPolyTree(tree).map((p: any) => ({
              p,
              closed: false,
            })),
          ].map(({ p, closed }: any) => ({
            points: p.map((v: any) => ({ x: v.X / 100000, y: v.Y / 100000 })),
            closed,
            hole: false,
          }));
        }
        contours.push(...paths);
      } else if ((item as paper.Group).children) {
        const group = item as paper.Group;
        let next = clips;
        if (group.clipped) {
          const mask = group.children.find((c) => c.clipMask);
          const paths: Point[][] = [];
          const collect = (c: paper.Item) => {
            if (c.className === "Path") paths.push(pointsOf(c as paper.Path));
            else if (c.className === "Shape")
              paths.push(
                pointsOf((c as paper.Shape).toPath(false), c.parent ?? c),
              );
            else
              for (const child of (c as paper.Group).children ?? [])
                collect(child);
          };
          if (mask) collect(mask);
          next = [
            ...clips,
            { paths, evenOdd: (mask as paper.Path)?.fillRule === "evenodd" },
          ];
        }
        for (const child of group.children)
          if (!child.clipMask) visit(child, next);
      }
    };
    visit(root);
    return finish(name, contours);
  } finally {
    scope.project.remove();
  }
}
export function importDxf(
  source: string,
  name: string,
  unit: "mm" | "in" = "mm",
  onNotice: (message: string) => void = () => {},
): Part {
  const data = new DxfParser().parseSync(source);
  if (!data) throw Error("Invalid DXF.");
  const contours: Contour[] = [],
    unsupported = new Set<string>();
  const code = data.header?.$INSUNITS;
  const factor = code === 1 ? 25.4 : code === 4 ? 1 : unit === "in" ? 25.4 : 1;
  let skippedPoints = 0;
  for (const entity of data.entities as any[]) {
    // POINT is a location marker, not a line, arc or pierce operation.
    if (entity.type === "POINT") {
      skippedPoints++;
      continue;
    }
    let points: Point[] = [],
      closed = false;
    let ocsX = 1;
    if (entity.type === "LINE") points = entity.vertices;
    else if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
      if (
        entity.is3dPolyline ||
        entity.is3dPolygonMesh ||
        entity.isPolyfaceMesh ||
        entity.includesCurveFitVertices ||
        entity.includesSplineFitVertices
      ) {
        unsupported.add(
          "3D, mesh or spline-fit POLYLINE (export a flat 2D outline)",
        );
        continue;
      }
      const normal = entity.extrusionDirection ?? {
        x: entity.extrusionDirectionX ?? 0,
        y: entity.extrusionDirectionY ?? 0,
        z: entity.extrusionDirectionZ ?? 1,
      };
      if (
        normal.x !== 0 ||
        normal.y !== 0 ||
        !Number.isFinite(normal.z) ||
        normal.z === 0
      ) {
        unsupported.add("tilted polyline extrusion (export a flat XY outline)");
        continue;
      }
      // The DXF arbitrary-axis basis for a -Z normal mirrors the OCS X axis.
      ocsX = normal.z < 0 ? -1 : 1;
      closed = !!entity.shape;
      points = flattenDxfPolyline(entity.vertices, closed, factor);
    } else if (entity.type === "CIRCLE" || entity.type === "ARC") {
      const start = entity.type === "CIRCLE" ? 0 : entity.startAngle;
      let span =
        entity.type === "CIRCLE" ? 2 * Math.PI : entity.endAngle - start;
      if (span <= 0) span += 2 * Math.PI;
      const count = Math.max(
        12,
        Math.min(
          4096,
          Math.ceil(span * Math.sqrt((entity.radius * factor) / 0.16)),
        ),
      );
      closed = entity.type === "CIRCLE";
      points = Array.from({ length: count + (closed ? 0 : 1) }, (_, i) => ({
        x:
          entity.center.x +
          entity.radius * Math.cos(start + (span * i) / count),
        y:
          entity.center.y +
          entity.radius * Math.sin(start + (span * i) / count),
      }));
    } else {
      unsupported.add(entity.type);
      continue;
    }
    // DXF uses Y-up; editor coordinates use Y-down.
    points = points.map((p) => ({ x: p.x * factor * ocsX, y: -p.y * factor }));
    if (
      points.length > 2 &&
      distance(points[0], points[points.length - 1]) < 0.001
    ) {
      closed = true;
      points.pop();
    }
    if (points.length >= 2) contours.push({ points, closed, hole: false });
  }
  if (unsupported.size)
    throw Error(
      `Unsupported DXF entities: ${[...unsupported].join(", ")}. Convert these to lines/arcs before importing.`,
    );
  if (!contours.length && skippedPoints)
    throw Error(
      "DXF contains only point markers and no cuttable paths. Export the part outlines as lines, arcs or polylines.",
    );
  const part = finish(name, contours);
  if (skippedPoints)
    onNotice(
      `Skipped ${skippedPoints} DXF POINT marker${skippedPoints === 1 ? "" : "s"}; cut paths were retained.`,
    );
  return part;
}

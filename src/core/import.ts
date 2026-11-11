import paper from "paper/dist/paper-core";
import DxfParser from "dxf-parser";
import { makePart, type Contour, type Part, type Point } from "./model";
import { bounds, distance } from "./geometry";
import { flattenDxfPolyline } from "./dxf-polyline";
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
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw Error("SVG document declarations are unsupported.");
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw Error("Invalid SVG file.");
  const svg = doc.documentElement;
  if (svg.localName !== "svg") throw Error("Expected an SVG root.");
  const allowed = new Set([
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "polygon",
    "polyline",
    "line",
    "title",
    "desc",
  ]);
  for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    if (!allowed.has(el.localName))
      throw Error(
        `SVG element <${el.localName}> is unsupported. Convert text and objects to paths; remove definitions and images.`,
      );
    for (const a of Array.from(el.attributes))
      if (
        /^on/i.test(a.name) ||
        /href/i.test(a.name) ||
        /url\s*\(/i.test(a.value)
      )
        throw Error(
          "SVG active content and resource references are unsupported.",
        );
  }
  const vb = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = svg.getAttribute("width") || "";
  const match = width.match(/^([\d.]+)\s*(mm|cm|in|px|pt)?$/);
  const units: Record<string, number> = {
    mm: 1,
    cm: 10,
    in: 25.4,
    px: 25.4 / 96,
    pt: 25.4 / 72,
  };
  const physical = match ? Number(match[1]) * units[match[2] || "px"] : 0;
  const factor =
    vb && vb.length === 4 && vb[2] > 0 && physical > 0
      ? physical / vb[2]
      : 25.4 / 96;
  if (vb && vb.length === 4) {
    svg.setAttribute("width", String(vb[2]));
    svg.setAttribute("height", String(vb[3]));
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
    const visit = (item: paper.Item) => {
      if (item.className === "Path") {
        const path = item as paper.Path;
        path.flatten(0.08 / factor);
        if (path.segments.length > 1)
          contours.push({
            closed: path.closed,
            hole: false,
            points: path.segments.map((s) => {
              const p = path.localToGlobal(s.point);
              return { x: p.x * factor, y: p.y * factor };
            }),
          });
      } else if ((item as paper.Group).children)
        for (const child of (item as paper.Group).children) visit(child);
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
): Part {
  const data = new DxfParser().parseSync(source);
  if (!data) throw Error("Invalid DXF.");
  const contours: Contour[] = [],
    unsupported = new Set<string>();
  const code = data.header?.$INSUNITS;
  const factor = code === 1 ? 25.4 : code === 4 ? 1 : unit === "in" ? 25.4 : 1;
  for (const entity of data.entities as any[]) {
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
  return finish(name, contours);
}

import paper from "paper/dist/paper-core";
import DxfParser from "dxf-parser";
import { makePart, type Contour, type Part, type Point } from "./model";
import { bounds, distance } from "./geometry";
import { flattenDxfPolyline } from "./dxf-polyline";
import { flattenDxfSpline, WeightedSplineParser } from "./dxf-spline";
import { prepareSvg } from "./svg-normalize";
import ClipperLib from "clipper-lib";
import {
  DEFAULT_IMPORT_TOLERANCE_MM,
  importTolerance,
  defaultImportSettings,
  type ImportSettings,
} from "./import-settings";
import { traceDxfText, tracePixels } from "./artwork-trace";
import type { RasterAsset } from "./import-assets";
import { registerExtraDxfEntities, hatchContours } from "./dxf-extra";
import { classifyImportedContours } from "./import-contours";
import { pointInPaths } from "./path-math";
const contains = (points: Point[], point: Point) =>
  pointInPaths([points], point);
function finish(name: string, contours: Contour[]): Part {
  contours = classifyImportedContours(contours);
  if (!contours.length) throw Error("No supported vector geometry found.");
  const b = bounds(contours.flatMap((c) => c.points));
  return makePart(
    name,
    contours.map((c) => ({
      ...c,
      points: c.points.map((p) => ({ x: p.x - b.x, y: p.y - b.y })),
    })),
  );
}
export function importSvg(
  source: string,
  name: string,
  toleranceMm = DEFAULT_IMPORT_TOLERANCE_MM,
  preserveOrigin = false,
): Part {
  importTolerance(toleranceMm);
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
      const m = space.globalMatrix;
      const norm = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d,
        det = m.a * m.d - m.b * m.c;
      const stretch =
        Math.sqrt(
          (norm + Math.sqrt(Math.max(0, norm * norm - 4 * det * det))) / 2,
        ) || 1;
      copy.flatten(toleranceMm / factor / stretch);
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
    return preserveOrigin ? makePart(name, contours) : finish(name, contours);
  } finally {
    scope.project.remove();
  }
}
export function importDxf(
  source: string,
  name: string,
  unit: "mm" | "in" = "mm",
  _onNotice: (message: string) => void = () => {},
  toleranceMm = DEFAULT_IMPORT_TOLERANCE_MM,
  artworkSettings: ImportSettings = defaultImportSettings(),
  imageAssets: Map<string, RasterAsset> = new Map(),
): Part {
  importTolerance(toleranceMm);
  const parser = new DxfParser();
  registerExtraDxfEntities(parser, source);
  parser.registerEntityHandler(WeightedSplineParser);
  const data = parser.parseSync(source);
  if (!data) throw Error("Invalid DXF.");
  const contours: Contour[] = [],
    unsupported = new Set<string>();
  const code = data.header?.$INSUNITS;
  const units: Record<number, number> = {
    1: 25.4,
    2: 304.8,
    3: 1609344,
    4: 1,
    5: 10,
    6: 1000,
    7: 1000000,
    8: 0.0000254,
    9: 0.0254,
    10: 914.4,
    11: 1e-7,
    12: 1e-6,
    13: 0.001,
    14: 100,
    15: 10000,
    16: 100000,
    17: 1e12,
    18: 149597870700000,
    19: 9460730472580800000,
    20: 30856775814913673000,
    21: 1200000 / 3937,
    22: 100000 / 3937,
    23: 3600000 / 3937,
    24: 6336000000 / 3937,
  };
  if (code && units[Number(code)] === undefined)
    throw Error(
      `DXF declares unknown units ${code}; export with standard drawing units.`,
    );
  const factor = code ? units[Number(code)] : unit === "in" ? 25.4 : 1;
  type Matrix = [number, number, number, number, number, number];
  const identity: Matrix = [1, 0, 0, 1, 0, 0];
  const multiply = (a: Matrix, b: Matrix): Matrix => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const normalSign = (normal: any, label: string) => {
    const n = normal ?? { x: 0, y: 0, z: 1 };
    if (
      (n.x ?? 0) !== 0 ||
      (n.y ?? 0) !== 0 ||
      !Number.isFinite(n.z ?? 1) ||
      (n.z ?? 1) === 0
    )
      throw Error(`Tilted ${label} extrusion: export a flat XY outline.`);
    return (n.z ?? 1) < 0 ? -1 : 1;
  };
  let skippedPoints = 0,
    visited = 0,
    totalPoints = 0;
  const store = (points: Point[], closed: boolean) => {
    if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
      throw Error("DXF contains invalid transformed coordinates.");
    if (
      points.length > 2 &&
      distance(points[0], points.at(-1)!) < Math.min(0.001, toleranceMm / 2)
    ) {
      closed = true;
      points.pop();
    }
    if (points.length >= 2) contours.push({ points, closed, hole: false });
    totalPoints += points.length;
    if (contours.length > 1000 || totalPoints > 500000)
      throw Error("DXF exceeds the supported contour/point limits.");
  };
  function visit(
    entity: any,
    matrix: Matrix = identity,
    stack: string[] = [],
  ): void {
    if (++visited > 50000)
      throw Error("DXF block expansion exceeds 50,000 entities.");
    // POINT is a location marker, not a line, arc or pierce operation.
    if (entity.type === "POINT") {
      skippedPoints++;
      return;
    }
    if (entity.type === "INSERT") {
      const block = data!.blocks?.[entity.name];
      if (!block)
        throw Error(`DXF INSERT references missing block: ${entity.name}`);
      if (block.xrefPath)
        throw Error(
          `DXF INSERT uses external block ${entity.name}; embed the block before importing.`,
        );
      if (stack.includes(entity.name) || stack.length >= 32)
        throw Error(
          `DXF INSERT has a circular or excessively nested block reference: ${entity.name}`,
        );
      const sx = entity.xScale ?? 1,
        sy = entity.yScale ?? 1,
        angle = ((entity.rotation ?? 0) * Math.PI) / 180;
      const pos = entity.position ?? { x: 0, y: 0 },
        base = block.position ?? { x: 0, y: 0 };
      const columns = entity.columnCount ?? 1,
        rows = entity.rowCount ?? 1,
        dx = entity.columnSpacing ?? 0,
        dy = entity.rowSpacing ?? 0;
      if (
        ![sx, sy, angle, pos.x, pos.y, base.x, base.y, dx, dy].every(
          Number.isFinite,
        ) ||
        sx === 0 ||
        sy === 0 ||
        !Number.isInteger(columns) ||
        !Number.isInteger(rows) ||
        columns < 1 ||
        rows < 1 ||
        columns * rows > 10000
      )
        throw Error(
          "DXF INSERT has invalid scale, position or array dimensions.",
        );
      const sign = normalSign(entity.extrusionDirection, "block"),
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      const rotation: Matrix = [
        sign * cos,
        sin,
        -sign * sin,
        cos,
        sign * pos.x,
        pos.y,
      ];
      const scaledBase: Matrix = [sx, 0, 0, sy, -sx * base.x, -sy * base.y];
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < columns; col++) {
          const grid: Matrix = [1, 0, 0, 1, col * dx, row * dy];
          const child = multiply(
            matrix,
            multiply(rotation, multiply(grid, scaledBase)),
          );
          for (const item of block.entities ?? [])
            visit(item, child, [...stack, entity.name]);
        }
      return;
    }
    const norm =
        matrix[0] ** 2 + matrix[1] ** 2 + matrix[2] ** 2 + matrix[3] ** 2,
      det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    const mmPerUnit =
      factor *
      Math.sqrt(
        (norm + Math.sqrt(Math.max(0, norm * norm - 4 * det * det))) / 2,
      );
    const convert = (p: Point) => ({
      x: (matrix[0] * p.x + matrix[2] * p.y + matrix[4]) * factor,
      y: -(matrix[1] * p.x + matrix[3] * p.y + matrix[5]) * factor,
    });
    if (["TEXT", "MTEXT", "ATTRIB", "ATTDEF"].includes(entity.type)) {
      for (const c of traceDxfText(entity, mmPerUnit, {
        ...artworkSettings,
        curveToleranceMm: toleranceMm,
      }))
        store(c.points.map(convert), c.closed);
      return;
    }
    if (entity.type === "DIMENSION") {
      if (!data!.blocks?.[entity.block])
        throw Error(
          "DXF dimension has no embedded drawing block. Regenerate its dimension graphics before exporting.",
        );
      visit(
        { type: "INSERT", name: entity.block, position: { x: 0, y: 0 } },
        matrix,
        stack,
      );
      return;
    }
    if (entity.type === "HATCH") {
      for (const contour of hatchContours(
        entity.rawGroups,
        mmPerUnit,
        toleranceMm,
      ))
        store(contour.points.map(convert), contour.closed);
      return;
    }
    if (entity.type === "IMAGE") {
      const groups = entity.rawGroups as { code: number; value: any }[],
        value = (code: number, fallback = 0) =>
          Number(groups.find((g) => g.code === code)?.value ?? fallback);
      const handle = String(groups.find((g) => g.code === 340)?.value ?? ""),
        image = imageAssets.get(handle);
      if (!image)
        throw Error(
          "DXF IMAGE has no readable image asset. Keep the image file beside the DXF or include it in the upload.",
        );
      const u = { x: value(11), y: value(21) },
        v = { x: value(12), y: value(22) },
        size = { x: value(13, image.width), y: value(23, image.height) },
        origin = { x: value(10), y: value(20) };
      if (
        Math.abs(value(31)) > 1e-8 ||
        Math.abs(value(32)) > 1e-8 ||
        size.x <= 0 ||
        size.y <= 0
      )
        throw Error("DXF IMAGE has invalid or tilted pixel axes.");
      const maxStretch =
        Math.hypot(u.x, u.y, v.x, v.y) *
        Math.max(size.x / image.width, size.y / image.height);
      if (!Number.isFinite(maxStretch) || maxStretch <= 0)
        throw Error("DXF IMAGE has invalid pixel scaling.");
      let pixels = image.data;
      if (value(280) === 1) {
        const clip: Point[] = [];
        for (let i = 0; i < groups.length; i++)
          if (groups[i].code === 14)
            clip.push({
              x: Number(groups[i].value),
              y: Number(
                groups.slice(i + 1).find((g) => g.code === 24)?.value ?? 0,
              ),
            });
        const polygon =
          clip.length === 2
            ? [
                clip[0],
                { x: clip[1].x, y: clip[0].y },
                clip[1],
                { x: clip[0].x, y: clip[1].y },
              ]
            : clip;
        if (polygon.length >= 3) {
          pixels = new Uint8ClampedArray(pixels);
          for (let y = 0; y < image.height; y++)
            for (let x = 0; x < image.width; x++)
              if (
                !contains(polygon, {
                  x: ((x + 0.5) * size.x) / image.width - 0.5,
                  y: size.y - ((y + 0.5) * size.y) / image.height - 0.5,
                })
              )
                pixels[(y * image.width + x) * 4 + 3] = 0;
        }
      }
      for (const c of tracePixels(pixels, image.width, image.height, 1, 1, {
        ...artworkSettings,
        curveToleranceMm: toleranceMm / (mmPerUnit * maxStretch),
      }))
        store(
          c.points.map((p) =>
            convert({
              x:
                origin.x +
                (u.x * p.x * size.x) / image.width +
                v.x * (size.y - (p.y * size.y) / image.height),
              y:
                origin.y +
                (u.y * p.x * size.x) / image.width +
                v.y * (size.y - (p.y * size.y) / image.height),
            }),
          ),
          true,
        );
      return;
    }
    let points: Point[] = [],
      closed = false;
    let ocsX = 1;
    if (
      entity.type === "LINE" ||
      entity.type === "LEADER" ||
      entity.type === "MLINE"
    )
      points = entity.vertices;
    else if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
      if (entity.is3dPolygonMesh || entity.isPolyfaceMesh) {
        unsupported.add("polygon/polyface mesh (export a flat 2D outline)");
        return;
      }
      if (
        entity.is3dPolyline &&
        entity.vertices.some(
          (p: any) => Math.abs((p.z ?? 0) - (entity.vertices[0].z ?? 0)) > 1e-8,
        )
      )
        throw Error(
          "Non-planar 3D polyline: choose a flat projection before importing.",
        );
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
        return;
      }
      // The DXF arbitrary-axis basis for a -Z normal mirrors the OCS X axis.
      ocsX = entity.is3dPolyline ? 1 : normal.z < 0 ? -1 : 1;
      closed = !!entity.shape;
      let vertices = entity.vertices;
      if (entity.includesCurveFitVertices || entity.includesSplineFitVertices) {
        const fitted = vertices.filter(
          (p: any) => p.curveFittingVertex || p.splineVertex,
        );
        if (fitted.length >= 2) {
          vertices = fitted;
        } else {
          points = flattenDxfSpline(
            {
              degreeOfSplineCurve: 3,
              controlPoints: [],
              knotValues: [],
              fitPoints: vertices,
              closed,
            },
            mmPerUnit,
            toleranceMm,
          );
        }
      }
      if (!points.length)
        points = flattenDxfPolyline(vertices, closed, mmPerUnit, toleranceMm);
    } else if (entity.type === "SPLINE") {
      points = flattenDxfSpline(entity, mmPerUnit, toleranceMm);
      closed = !!(entity.closed || entity.periodic);
    } else if (entity.type === "ELLIPSE") {
      const major = entity.majorAxisEndPoint,
        radius = Math.hypot(major.x, major.y),
        ratio = entity.axisRatio;
      if (
        !Number.isFinite(radius) ||
        radius <= 0 ||
        !Number.isFinite(ratio) ||
        ratio <= 0 ||
        ratio > 1 ||
        Math.abs(major.z ?? 0) > 1e-8
      )
        throw Error("DXF ellipse has invalid or tilted axes.");
      const start = entity.startAngle ?? 0;
      let span = (entity.endAngle ?? 2 * Math.PI) - start;
      if (span <= 0) span += 2 * Math.PI;
      const count = Math.max(
        12,
        Math.ceil(span / Math.sqrt((8 * toleranceMm) / (radius * mmPerUnit))),
      );
      if (count > 20000)
        throw Error(
          "DXF ellipse exceeds 20,000 nodes; increase import tolerance.",
        );
      closed = Math.abs(span - 2 * Math.PI) < 1e-8;
      points = Array.from({ length: count + (closed ? 0 : 1) }, (_, i) => {
        const t = start + (span * i) / count;
        return {
          x:
            entity.center.x +
            major.x * Math.cos(t) -
            major.y * ratio * Math.sin(t),
          y:
            entity.center.y +
            major.y * Math.cos(t) +
            major.x * ratio * Math.sin(t),
        };
      });
    } else if (["SOLID", "3DFACE", "TRACE"].includes(entity.type)) {
      points = entity.points ?? entity.vertices ?? [];
      if (
        points.some(
          (p: any) =>
            Math.abs((p.z ?? 0) - ((points[0] as any)?.z ?? 0)) > 1e-8,
        )
      )
        throw Error("Non-planar DXF face: export its flat XY boundary.");
      if (entity.type !== "3DFACE" && points.length === 4)
        points = [points[0], points[1], points[3], points[2]];
      closed = true;
    } else if (entity.type === "CIRCLE" || entity.type === "ARC") {
      ocsX = normalSign(entity.extrusionDirection, "arc/circle");
      const start = entity.type === "CIRCLE" ? 0 : entity.startAngle;
      let span =
        entity.type === "CIRCLE" ? 2 * Math.PI : entity.endAngle - start;
      if (span <= 0) span += 2 * Math.PI;
      if (!Number.isFinite(entity.radius) || entity.radius <= 0)
        throw Error("DXF circle/arc has an invalid radius.");
      const step =
        2 *
        Math.acos(Math.max(-1, 1 - toleranceMm / (entity.radius * mmPerUnit)));
      const count = Math.max(12, Math.ceil(span / step));
      if (count > 20000)
        throw Error(
          "DXF arc exceeds 20,000 nodes; increase import tolerance or split the contour.",
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
      return;
    }
    // DXF uses Y-up; editor coordinates use Y-down.
    points = points.map((p) => ({
      x: (matrix[0] * p.x * ocsX + matrix[2] * p.y + matrix[4]) * factor,
      y: -(matrix[1] * p.x * ocsX + matrix[3] * p.y + matrix[5]) * factor,
    }));
    store(points, closed);
  }
  for (const entity of data.entities) visit(entity);
  if (unsupported.size)
    throw Error(
      `Unsupported DXF entities: ${[...unsupported].join(", ")}. Convert these to lines/arcs before importing.`,
    );
  if (!contours.length && skippedPoints)
    throw Error(
      "DXF contains only point markers and no cuttable paths. Export the part outlines as lines, arcs or polylines.",
    );
  return finish(name, contours);
}

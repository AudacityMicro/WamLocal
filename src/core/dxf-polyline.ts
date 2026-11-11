import type { Point } from "./model";

export const DXF_CURVE_TOLERANCE_MM = 0.08;
const MAX_POINTS = 20000;
type Vertex = Point & { bulge?: number };

/** DXF group 42 = tan(signed sweep / 4), attached to the segment's start.
 * Flatten in OCS before the caller converts units, extrusion and the Y axis.
 * https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-0741E831-599E-4CBF-91E1-8ADBCFD6556D.htm
 */
export function flattenDxfPolyline(
  vertices: Vertex[],
  closed: boolean,
  mmPerUnit: number,
): Point[] {
  if (!Number.isFinite(mmPerUnit) || mmPerUnit <= 0)
    throw Error("Invalid DXF units.");
  if (vertices.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw Error("DXF polyline contains invalid coordinates.");
  if (vertices.length < 2) return [];
  const tolerance = DXF_CURVE_TOLERANCE_MM / mmPerUnit;
  const points: Point[] = [{ x: vertices[0].x, y: vertices[0].y }];
  const segments = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < segments; i++) {
    const start = vertices[i],
      end = vertices[(i + 1) % vertices.length];
    const bulge = start.bulge ?? 0;
    if (!Number.isFinite(bulge))
      throw Error("DXF polyline contains an invalid bulge.");
    const dx = end.x - start.x,
      dy = end.y - start.y;
    const chord = Math.hypot(dx, dy);
    if (!Number.isFinite(chord))
      throw Error("DXF polyline contains invalid coordinates.");
    if (chord === 0) {
      if (bulge !== 0)
        throw Error(
          "DXF curved segment has coincident endpoints; its arc cannot be determined.",
        );
      continue;
    }
    let count = 1;
    const sweep = 4 * Math.atan(bulge);
    const magnitude = Math.abs(bulge);
    // A minor arc's exact sagitta is chord * |bulge| / 2.
    const curved =
      bulge !== 0 && !(magnitude <= 1 && (chord * magnitude) / 2 <= tolerance);
    let offset = 0;
    if (curved) {
      const radius = (chord / 4) * (magnitude + 1 / magnitude);
      offset = (chord / 4) * (1 / bulge - bulge);
      // Stable sagitta bound; avoid acos(1-epsilon) for large radii.
      const maxAngle = Math.min(
        Math.PI / 2,
        4 * Math.asin(Math.sqrt(Math.min(1, tolerance / (2 * radius)))),
      );
      count = Math.ceil(Math.abs(sweep) / maxAngle);
      if (
        !Number.isFinite(radius) ||
        !Number.isFinite(offset) ||
        !Number.isFinite(count)
      )
        throw Error("DXF curved segment is too large to convert accurately.");
    }
    if (points.length + count > MAX_POINTS + 1)
      throw Error(
        "DXF polyline exceeds 20,000 points at 0.08 mm curve tolerance. Split the drawing into smaller contours.",
      );
    for (let step = 1; step <= count; step++) {
      if (step === count) points.push({ x: end.x, y: end.y });
      else {
        const angle = (sweep * step) / count;
        const sin = Math.sin(angle),
          cosMinusOne = -2 * Math.sin(angle / 2) ** 2;
        // Rotate the start radius in a chord-aligned frame. This avoids
        // subtracting a distant center from nearly identical large coordinates.
        const along = (-chord / 2) * cosMinusOne + offset * sin;
        const across = (-chord / 2) * sin - offset * cosMinusOne;
        points.push({
          x: start.x + (dx * along - dy * across) / chord,
          y: start.y + (dy * along + dx * across) / chord,
        });
      }
    }
  }
  if (
    closed &&
    points.length > 1 &&
    points.at(-1)!.x === points[0].x &&
    points.at(-1)!.y === points[0].y
  )
    points.pop();
  if (points.length > MAX_POINTS)
    throw Error(
      "DXF polyline exceeds 20,000 points at 0.08 mm curve tolerance. Split the drawing into smaller contours.",
    );
  return points;
}

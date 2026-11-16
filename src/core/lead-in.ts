import type { Contour, Point } from "./model";
import { pointInPaths } from "./path-math";

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const unit = (v: Point) => {
  const length = Math.hypot(v.x, v.y);
  return length > 1e-10 ? { x: v.x / length, y: v.y / length } : v;
};

/** Closed contours enter from scrap: inside a hole, outside an outer profile. */
export function leadInStart(contour: Contour, length: number): Point {
  const points = contour.points,
    entry = points[0];
  if (!length || !contour.closed || points.length < 3) return { ...entry };
  const next = points[1],
    prev = points.at(-1)!;
  const incoming = unit({ x: entry.x - prev.x, y: entry.y - prev.y });
  const outgoing = unit({ x: next.x - entry.x, y: next.y - entry.y });
  let tangent = unit({
    x: incoming.x + outgoing.x,
    y: incoming.y + outgoing.y,
  });
  if (Math.hypot(tangent.x, tangent.y) < 1e-8) tangent = outgoing;
  const signedArea = points.reduce(
    (sum, p, i) => sum + cross(p, points[(i + 1) % points.length]),
    0,
  );
  const side = (signedArea >= 0 ? 1 : -1) * (contour.hole ? 1 : -1);
  const direction = { x: -tangent.y * side, y: tangent.x * side };
  const probe = {
    x: entry.x + direction.x * 1e-5,
    y: entry.y + direction.y * 1e-5,
  };
  if (pointInPaths([points], probe) !== !!contour.hole) return { ...entry };

  // Stop before crossing another edge, keeping long leads within narrow scrap.
  let limit = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const fromEntry = { x: a.x - entry.x, y: a.y - entry.y };
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) < 1e-10) continue;
    const along = cross(fromEntry, edge) / denominator;
    const onEdge = cross(fromEntry, direction) / denominator;
    if (along > 1e-6 && onEdge >= -1e-8 && onEdge <= 1 + 1e-8)
      limit = Math.min(limit, along / 2);
  }
  const actual = Math.min(length, limit);
  return {
    x: entry.x + direction.x * actual,
    y: entry.y + direction.y * actual,
  };
}

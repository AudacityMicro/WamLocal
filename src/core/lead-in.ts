import type { Contour, Point } from "./model";
import { pointInPaths } from "./path-math";

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const unit = (v: Point) => {
  const length = Math.hypot(v.x, v.y);
  return length > 1e-10 ? { x: v.x / length, y: v.y / length } : v;
};

// Check all intervals separated by boundary intersections, including very
// narrow islands which fixed sampling could miss.
function scrapChord(contour: Contour, from: Point, to: Point) {
  const direction = { x: to.x - from.x, y: to.y - from.y },
    cuts = [0, 1];
  for (let i = 0; i < contour.points.length; i++) {
    const a = contour.points[i],
      b = contour.points[(i + 1) % contour.points.length];
    const edge = { x: b.x - a.x, y: b.y - a.y },
      denominator = cross(direction, edge);
    if (Math.abs(denominator) < 1e-12) continue;
    const relative = { x: a.x - from.x, y: a.y - from.y };
    const t = cross(relative, edge) / denominator,
      u = cross(relative, direction) / denominator;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  return cuts.slice(1).every((end, i) => {
    if (end - cuts[i] < 1e-9) return true;
    const t = (end + cuts[i]) / 2;
    return (
      pointInPaths([contour.points], {
        x: from.x + direction.x * t,
        y: from.y + direction.y * t,
      }) === !!contour.hole
    );
  });
}

/** Closed contours enter from scrap: inside a hole, outside an outer profile. */
export function smallHolePierce(
  contour: Contour,
  length: number,
  safePoint: (point: Point) => boolean = () => true,
): Point | undefined {
  if (
    !contour.closed ||
    !contour.hole ||
    length <= 0 ||
    contour.points.length < 3
  )
    return;
  const pts = contour.points,
    xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y);
  if (
    Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ) >
    2 * length + 1e-7
  )
    return;
  let twiceArea = 0,
    x = 0,
    y = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length],
      k = cross(a, b);
    twiceArea += k;
    x += (a.x + b.x) * k;
    y += (a.y + b.y) * k;
  }
  if (Math.abs(twiceArea) < 1e-10) return;
  const centroid = { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
  if (
    safePoint(centroid) &&
    pointInPaths([pts], centroid) &&
    scrapChord(contour, centroid, pts[0])
  )
    return centroid;
  // A concave polygon's area centroid can be outside its opening. Search
  // interior points, choosing the best boundary clearance visible from entry.
  let best: Point | undefined,
    clearance = -1;
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    width = Math.max(...xs) - minX,
    height = Math.max(...ys) - minY;
  for (let i = 0; i < 24; i++)
    for (let j = 0; j < 24; j++) {
      const p = {
        x: minX + (width * (i + 0.5)) / 24,
        y: minY + (height * (j + 0.5)) / 24,
      };
      if (
        !safePoint(p) ||
        !pointInPaths([pts], p) ||
        !scrapChord(contour, p, pts[0])
      )
        continue;
      let nearest = Infinity;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k],
          b = pts[(k + 1) % pts.length],
          dx = b.x - a.x,
          dy = b.y - a.y,
          t = Math.max(
            0,
            Math.min(
              1,
              ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
            ),
          );
        nearest = Math.min(
          nearest,
          Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy),
        );
      }
      if (nearest > clearance) {
        best = p;
        clearance = nearest;
      }
    }
  return best;
}
export function leadInStart(
  contour: Contour,
  length: number,
  centerAllowed = true,
): Point {
  const points = contour.points,
    entry = points[0];
  if (!length || !contour.closed || points.length < 3) return { ...entry };
  const center = centerAllowed ? smallHolePierce(contour, length) : undefined;
  if (center) return center;
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

/** Tangent quarter-circle, with requested length measured along the arc.
 * Shorten geometrically until every chord lies in this contour's scrap.
 * Fall back to the established normal entry at sharp/degenerate vertices.
 */
export function curvedLead(
  contour: Contour,
  length: number,
  exit = false,
  centerAllowed = true,
): Point[] {
  const entry = contour.points[0];
  if (!length || !contour.closed) return [{ ...entry }];
  const center = centerAllowed ? smallHolePierce(contour, length) : undefined;
  if (center) return exit ? [entry, center] : [center, entry];
  // At a polygon vertex the two tangents differ. Use the tangent whose arc
  // departs into scrap; at an edge-interior entry they coincide.
  const incoming = contour.hole ? !exit : exit;
  const neighbor = incoming ? contour.points.at(-1)! : contour.points[1];
  const dx = incoming ? entry.x - neighbor.x : neighbor.x - entry.x;
  const dy = incoming ? entry.y - neighbor.y : neighbor.y - entry.y;
  const norm = Math.hypot(dx, dy);
  if (norm < 1e-9) return [{ ...entry }];
  const tx = dx / norm,
    ty = dy / norm;
  const signed = contour.points.reduce(
    (n, p, i) => n + cross(p, contour.points[(i + 1) % contour.points.length]),
    0,
  );
  const side = (signed >= 0 ? 1 : -1) * (contour.hole ? 1 : -1);
  const nx = -ty * side,
    ny = tx * side;
  for (let attempt = 0; attempt < 14; attempt++) {
    const radius = ((length * 2) / Math.PI) * 0.7 ** attempt;
    const steps = Math.max(
      12,
      Math.ceil(
        Math.PI / 2 / (2 * Math.acos(Math.max(-1, 1 - 0.001 / radius))),
      ),
    );
    const points = Array.from({ length: steps + 1 }, (_, i) => {
      const a = ((Math.PI / 2) * i) / steps;
      return {
        x:
          entry.x +
          nx * radius * (1 - Math.cos(a)) +
          tx * radius * Math.sin(a) * (exit ? 1 : -1),
        y:
          entry.y +
          ny * radius * (1 - Math.cos(a)) +
          ty * radius * Math.sin(a) * (exit ? 1 : -1),
      };
    });
    if (points.slice(1).every((p, i) => scrapChord(contour, points[i], p)))
      return exit ? points : points.reverse();
  }
  const normal = leadInStart(contour, length, centerAllowed);
  return exit ? [entry, normal] : [normal, entry];
}

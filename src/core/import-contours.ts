import type { Contour, Point } from "./model";
const precision = 1e7;
// Minimal cyclic rotation (Booth), independent of start vertex and winding.
function rotation(tokens: string[]) {
  const n = tokens.length;
  let a = 0,
    b = 1,
    k = 0;
  while (a < n && b < n && k < n) {
    const x = tokens[(a + k) % n],
      y = tokens[(b + k) % n];
    if (x === y) {
      k++;
      continue;
    }
    if (x > y) {
      a += k + 1;
      if (a === b) a++;
    } else {
      b += k + 1;
      if (a === b) b++;
    }
    k = 0;
  }
  const start = Math.min(a, b);
  return [...tokens.slice(start), ...tokens.slice(0, start)].join(";");
}
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
function keyPoints(points: Point[], closed: boolean) {
  const straight = (a: Point, b: Point, c: Point) =>
    Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) <=
      Math.hypot(c.x - a.x, c.y - a.y) / precision &&
    (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0;
  const result: Point[] = [];
  for (const p of points) {
    while (
      result.length > 1 &&
      straight(result[result.length - 2], result.at(-1)!, p)
    )
      result.pop();
    result.push(p);
  }
  if (closed) {
    while (
      result.length > 2 &&
      straight(result.at(-2)!, result.at(-1)!, result[0])
    )
      result.pop();
    while (result.length > 2 && straight(result.at(-1)!, result[0], result[1]))
      result.shift();
  }
  return result;
}
/** Coincident CAD entities are one cut, not an extra level of hole nesting.
 * Quantize only the duplicate key, at 0.0000001 mm; preserve source vertices. */
export function deduplicateContours(input: Contour[]): Contour[] {
  const seen = new Set<string>(),
    contours: Contour[] = [];
  for (const c of input) {
    const points = c.points.filter(
      (p, i) =>
        !i ||
        Math.hypot(p.x - c.points[i - 1].x, p.y - c.points[i - 1].y) >
          1 / precision,
    );
    if (
      c.closed &&
      points.length > 1 &&
      Math.hypot(
        points[0].x - points.at(-1)!.x,
        points[0].y - points.at(-1)!.y,
      ) <=
        1 / precision
    )
      points.pop();
    if (points.length < 2) continue;
    const tokens = keyPoints(points, c.closed).map(
        (p) => `${Math.round(p.x * precision)},${Math.round(p.y * precision)}`,
      ),
      forward = c.closed ? rotation(tokens) : tokens.join(";"),
      reverse = c.closed
        ? rotation([...tokens].reverse())
        : [...tokens].reverse().join(";");
    const key = `${c.closed ? "closed" : "open"}|${forward < reverse ? forward : reverse}`;
    if (seen.has(key)) continue;
    seen.add(key);
    contours.push({ ...c, points });
  }
  return contours;
}
export function classifyImportedContours(input: Contour[]): Contour[] {
  const contours = deduplicateContours(input);
  return contours.map((c) => ({
    ...c,
    hole:
      c.closed &&
      contours.filter(
        (other) =>
          other !== c && other.closed && contains(other.points, c.points[0]),
      ).length %
        2 ===
        1,
  }));
}

import type { Part, Point } from "./model";
import { transformed } from "./geometry";
import { pointInPaths } from "./path-math";

/** CAD window selection (rightward) or crossing selection (leftward).
 * Tests actual placed outlines, including holes and open paths. */
export function boxSelectParts(
  parts: Part[],
  start: Point,
  end: Point,
): string[] {
  const left = Math.min(start.x, end.x),
    right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y),
    bottom = Math.max(start.y, end.y);
  const inside = (p: Point) =>
    p.x >= left - 1e-8 &&
    p.x <= right + 1e-8 &&
    p.y >= top - 1e-8 &&
    p.y <= bottom + 1e-8;
  // Liang–Barsky clipping includes tangent and collinear boundary contact.
  const touches = (a: Point, b: Point) => {
    let lo = 0,
      hi = 1;
    for (const [v, d, min, max] of [
      [a.x, b.x - a.x, left, right],
      [a.y, b.y - a.y, top, bottom],
    ]) {
      if (Math.abs(d) < 1e-12) {
        if (v < min - 1e-8 || v > max + 1e-8) return false;
      } else {
        const t1 = (min - v) / d,
          t2 = (max - v) / d;
        lo = Math.max(lo, Math.min(t1, t2));
        hi = Math.min(hi, Math.max(t1, t2));
        if (lo > hi + 1e-8) return false;
      }
    }
    return true;
  };
  return parts
    .filter((part) => {
      const contours = transformed(part),
        points = contours.flatMap((c) => c.points);
      if (!points.length) return false;
      if (end.x >= start.x) return points.every(inside);
      if (points.some(inside)) return true;
      if (
        contours.some((c) =>
          c.points.some(
            (p, i) =>
              (c.closed || i < c.points.length - 1) &&
              touches(p, c.points[(i + 1) % c.points.length]),
          ),
        )
      )
        return true;
      return pointInPaths(
        contours.filter((c) => c.closed).map((c) => c.points),
        { x: left, y: top },
      );
    })
    .map((p) => p.id);
}

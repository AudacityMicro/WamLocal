import type { Point } from "./model";
export function pathLength(points: Point[], closed: boolean) {
  let total = 0;
  for (let i = 1; i < points.length + (closed ? 1 : 0); i++)
    total += Math.hypot(
      points[i % points.length].x - points[i - 1].x,
      points[i % points.length].y - points[i - 1].y,
    );
  return total;
}
export function pointOnPath(
  points: Point[],
  closed: boolean,
  fraction: number,
): Point {
  let left = Math.max(0, Math.min(1, fraction)) * pathLength(points, closed);
  for (let i = 1; i < points.length + (closed ? 1 : 0); i++) {
    const a = points[i - 1],
      b = points[i % points.length],
      len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len && len > 0)
      return {
        x: a.x + ((b.x - a.x) * left) / len,
        y: a.y + ((b.y - a.y) * left) / len,
      };
    left -= len;
  }
  return { ...points.at(-1)! };
}
export function closestOnPath(points: Point[], closed: boolean, target: Point) {
  let walked = 0,
    best = {
      distance: Infinity,
      fraction: 0,
      along: 0,
      index: 0,
      point: points[0],
    };
  const total = pathLength(points, closed);
  for (let i = 1; i < points.length + (closed ? 1 : 0); i++) {
    const a = points[i - 1],
      b = points[i % points.length],
      dx = b.x - a.x,
      dy = b.y - a.y,
      len = Math.hypot(dx, dy),
      t = len
        ? Math.max(
            0,
            Math.min(
              1,
              ((target.x - a.x) * dx + (target.y - a.y) * dy) / (len * len),
            ),
          )
        : 0;
    const point = { x: a.x + t * dx, y: a.y + t * dy },
      distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance < best.distance)
      best = {
        distance,
        fraction: total ? (walked + t * len) / total : 0,
        along: walked + t * len,
        index: i - 1,
        point,
      };
    walked += len;
  }
  return best;
}
export function movePathStart(points: Point[], target: Point) {
  const nearest = closestOnPath(points, true, target),
    after = nearest.index + 1;
  const reordered = [
    nearest.point,
    ...points.slice(after),
    ...points.slice(0, after),
  ];
  return reordered
    .filter(
      (p, i) =>
        i === 0 ||
        Math.hypot(p.x - reordered[i - 1].x, p.y - reordered[i - 1].y) > 1e-8,
    )
    .filter(
      (p, i, all) =>
        i !== all.length - 1 ||
        Math.hypot(p.x - all[0].x, p.y - all[0].y) > 1e-8,
    );
}
export function pointInPaths(paths: Point[][], point: Point) {
  let inside = false;
  for (const points of paths)
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i],
        b = points[j];
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
  return inside;
}

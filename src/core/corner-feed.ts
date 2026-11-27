import type { Move } from "./geometry";
import { distance } from "./geometry";

/** Geometry-based corner scheduling. The observed Pro square profile slows to
 * 45% at a right angle and recovers 20 percentage points per 5 mm. This is an
 * explicit approximation, not WAM's proprietary process model. */
export function scheduleCornerFeeds(moves: Move[], nominal: number): Move[] {
  if (moves.length < 2) return moves;
  const vertices = [moves[0].from, ...moves.map(m => m.to)];
  const walked = [0];
  for (let i = 1; i < vertices.length; i++) walked.push(walked[i - 1] + distance(vertices[i - 1], vertices[i]));
  const total = walked.at(-1)!;
  const lowerBound = (at: number) => {
    let lo = 0, hi = walked.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (walked[mid] < at) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const closed = distance(vertices[0], vertices.at(-1)!) < 0.0002;
  const corners: { at: number; factor: number }[] = [];
  for (let i = closed ? 0 : 1; i < vertices.length - 1; i++) {
    // Accumulate adjacent short join segments so rounded corners are treated as
    // one turn, while finely tessellated gentle curves keep their nominal feed.
    let before = Math.min(i - 1, Math.max(0, lowerBound(walked[i] - 1) - 1));
    const after = Math.min(vertices.length - 1, Math.max(i + 1, lowerBound(walked[i] + 1)));
    if (i === 0) before = vertices.length - 2;
    const a = vertices[before], p = vertices[i], b = vertices[after];
    const ux = p.x - a.x, uy = p.y - a.y, vx = b.x - p.x, vy = b.y - p.y;
    const divisor = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (!divisor) continue;
    const turn = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / divisor)));
    if (turn < Math.PI / 6) continue;
    corners.push({ at: walked[i], factor: Math.max(0.25, 1 - 1.1 * turn / Math.PI) });
  }
  if (!corners.length) return moves;
  const bins = new Map<number, typeof corners>();
  for (const corner of corners) for (const shift of closed ? [-total, 0, total] : [0]) {
    const copy = { ...corner, at: corner.at + shift };
    for (let bin = Math.floor((copy.at - 20) / 20); bin <= Math.floor((copy.at + 20) / 20); bin++) {
      if (!bins.has(bin)) bins.set(bin, []);
      bins.get(bin)!.push(copy);
    }
  }
  return moves.flatMap((move, i) => {
    const len = distance(move.from, move.to);
    const pieces = Math.max(1, Math.ceil(len / 1));
    const point = (t: number) => ({ x: move.from.x + (move.to.x - move.from.x) * t, y: move.from.y + (move.to.y - move.from.y) * t });
    return Array.from({ length: pieces }, (_, j) => {
      const start = walked[i] + len * j / pieces, end = walked[i] + len * (j + 1) / pieces;
      const nearby = bins.get(Math.floor((start + end) / 2 / 20)) ?? [];
      const factor = nearby.reduce((factor, corner) => {
        let gap = Math.min(Math.abs(corner.at - start), Math.abs(corner.at - end));
        if (corner.at >= start && corner.at <= end) gap = 0;
        return Math.min(factor, corner.factor + gap * 0.04);
      }, 1);
      return { ...move, from: point(j / pieces), to: point((j + 1) / pieces), feed: nominal * Math.max(0.25, factor) };
    });
  });
}

import type { Move } from "./geometry";
const length = (m: Move) => Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
const mix = (m: Move, t: number) => ({
  x: m.from.x + (m.to.x - m.from.x) * t,
  y: m.from.y + (m.to.y - m.from.y) * t,
});
/** Extend the start backwards and the end forwards around a closed profile.
 * Stop at actual tab gaps; never re-cut a retaining bridge to satisfy overlap.
 */
export function overlapProfile(
  moves: Move[],
  closed: boolean,
  leadIn = 0,
  leadOut = 0,
): Move[] {
  if (!closed || !moves.length || (leadIn <= 0 && leadOut <= 0)) return moves;
  const total = moves.reduce((s, m) => s + length(m), 0);
  const prefix: Move[] = [],
    suffix: Move[] = [];
  let remaining = Math.min(leadIn, total);
  for (let i = moves.length - 1; i >= 0 && remaining > 1e-8; i--) {
    const m = moves[i];
    if (m.kind !== "cut") break;
    const len = length(m);
    if (len < 1e-10) continue;
    const take = Math.min(len, remaining);
    prefix.unshift({ ...m, from: mix(m, 1 - take / len) });
    remaining -= take;
  }
  remaining = Math.min(leadOut, total);
  for (const m of moves) {
    if (remaining <= 1e-8 || m.kind !== "cut") break;
    const len = length(m);
    if (len < 1e-10) continue;
    const take = Math.min(len, remaining);
    suffix.push({ ...m, to: mix(m, take / len) });
    remaining -= take;
  }
  return [...prefix, ...moves, ...suffix];
}

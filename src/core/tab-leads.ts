import type { Move } from "./geometry";
import type { Point } from "./model";
export type TabMove = Move & { bridgeWidth?: number };
const length = (m: Move) => Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
const mix = (m: Move, t: number) => ({
  x: m.from.x + (m.to.x - m.from.x) * t,
  y: m.from.y + (m.to.y - m.from.y) * t,
});

/** Reserve room for the lateral sweep of tangent leads on both sides of a tab.
 * The configured width is the minimum finished bridge, including its outer neck.
 */
export function reserveTabLeads(
  moves: Move[],
  padding: number,
  kerf: number,
): TabMove[] {
  if (!moves.some((m) => m.kind === "tab") || padding <= 0) return moves;
  const groups: { kind: string; start: number; end: number }[] = [];
  let total = 0;
  for (const m of moves) {
    const last = groups.at(-1),
      end = total + length(m);
    if (last?.kind === m.kind) last.end = end;
    else groups.push({ kind: m.kind, start: total, end });
    total = end;
  }
  if (groups.length > 1 && groups[0].kind === groups.at(-1)!.kind) {
    groups[0].start = groups.at(-1)!.start - total;
    groups.pop();
  }
  const cuts = groups.filter((g) => g.kind === "cut");
  if (!cuts.length) return moves;
  // Leave cut spans available even for tiny holes/closely spaced tabs. The
  // subsequent swept-path check shortens their arcs to the available clearance.
  padding = Math.min(padding, ...cuts.map((g) => (g.end - g.start) * 0.24));
  const gaps = groups
    .filter((g) => g.kind === "tab")
    .flatMap((g) =>
      [-total, 0, total].map((shift) => ({
        start: g.start - padding + shift,
        end: g.end + padding + shift,
        width: Math.max(0, g.end - g.start - kerf),
      })),
    );
  const result: TabMove[] = [];
  let along = 0;
  for (const m of moves) {
    const len = length(m);
    if (len < 1e-10) continue;
    const splits = [
      0,
      len,
      ...gaps
        .flatMap((g) => [g.start - along, g.end - along])
        .filter((d) => d > 1e-9 && d < len - 1e-9),
    ].sort((a, b) => a - b);
    for (let i = 1; i < splits.length; i++) {
      const mid = along + (splits[i - 1] + splits[i]) / 2,
        cover = gaps.filter((g) => mid >= g.start && mid <= g.end);
      result.push({
        ...m,
        from: mix(m, splits[i - 1] / len),
        to: mix(m, splits[i] / len),
        kind: cover.length ? "tab" : m.kind,
        ...(cover.length
          ? { bridgeWidth: Math.max(...cover.map((g) => g.width)) }
          : {}),
      });
    }
    along += len;
  }
  return result;
}

function pointSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  if (
    cross(a, b, c) * cross(a, b, d) < 0 &&
    cross(c, d, a) * cross(c, d, b) < 0
  )
    return 0;
  return Math.min(
    pointSegment(a, c, d),
    pointSegment(b, c, d),
    pointSegment(c, a, b),
    pointSegment(d, a, b),
  );
}
function pointPath(p: Point, path: Point[]) {
  return path.length === 1
    ? Math.hypot(p.x - path[0].x, p.y - path[0].y)
    : Math.min(...path.slice(1).map((b, i) => pointSegment(p, path[i], b)));
}
export function tabLeadsClear(
  exit: Point[],
  entry: Point[],
  kerf: number,
  pierceDiameter: number,
  width: number,
) {
  const tolerance = 0.0002;
  const a = exit.length === 1 ? [exit[0], exit[0]] : exit,
    b = entry.length === 1 ? [entry[0], entry[0]] : entry;
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++)
      if (
        segmentDistance(a[i - 1], a[i], b[j - 1], b[j]) + tolerance <
        kerf + width
      )
        return false;
  const tipRadius = Math.max(kerf, pierceDiameter) / 2;
  return (
    pointPath(exit.at(-1)!, entry) + tolerance >=
      tipRadius + kerf / 2 + width &&
    pointPath(entry[0], exit) + tolerance >= tipRadius + kerf / 2 + width &&
    Math.hypot(exit.at(-1)!.x - entry[0].x, exit.at(-1)!.y - entry[0].y) +
      tolerance >=
      2 * tipRadius + width
  );
}

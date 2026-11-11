import ClipperLib from "clipper-lib";
import { packSheet, partsOverlap } from "./nesting";
import {
  closestOnPath,
  pointOnPath,
  movePathStart,
  pointInPaths,
} from "./path-math";
import type { Contour, Part, Point, Project } from "./model";
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const area = (pts: Point[]) =>
  pts.reduce((a, p, i) => {
    const q = pts[(i + 1) % pts.length];
    return a + p.x * q.y - q.x * p.y;
  }, 0) / 2;
export function bounds(points: Point[]) {
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of points) {
    x = Math.min(x, p.x);
    y = Math.min(y, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return { x, y, width: right - x, height: bottom - y };
}
export function transformed(part: Part): Contour[] {
  const a = (part.rotation * Math.PI) / 180;
  return part.contours.map((c) => ({
    ...c,
    points: c.points.map((p) => ({
      x: part.x + part.scale * (p.x * Math.cos(a) - p.y * Math.sin(a)),
      y: part.y + part.scale * (p.x * Math.sin(a) + p.y * Math.cos(a)),
    })),
  }));
}
export function partBounds(p: Part) {
  return bounds(transformed(p).flatMap((c) => c.points));
}
const S = 10000;
const clipPath = (ps: Point[]) =>
  ps.map((p) => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) }));
export function offset(c: Contour, delta: number): Contour[] {
  if (!c.closed || delta === 0) return [c];
  const off = new ClipperLib.ClipperOffset(2, 0.03 * S),
    out: any[] = [];
  off.AddPath(
    clipPath(area(c.points) < 0 ? [...c.points].reverse() : c.points),
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon,
  );
  off.Execute(out, delta * S);
  return out.map((ps) => ({
    ...c,
    points: ps.map((p: any) => ({ x: p.X / S, y: p.Y / S })),
  }));
}
export function nest(project: Project, rotate = true): Project {
  const result = packSheet(project, rotate);
  if (result.unplaced.length)
    throw Error(
      "No fit found for all parts within the nesting search. Try another sheet, smaller clearances, or manual placement; this is not proof they cannot fit.",
    );
  return {
    ...project,
    parts: project.parts.map((p) => result.parts.find((q) => q.id === p.id)!),
  };
}
export type Move = {
  from: Point;
  to: Point;
  kind: "rapid" | "cut" | "tab";
  partId: string;
  feed?: number;
};
export type Plan = {
  moves: Move[];
  cutLength: number;
  minutes: number;
  issues: string[];
  pierces: { point: Point; radius: number; partId: string; warning: boolean }[];
};
export function plan(project: Project): Plan {
  const moves: Move[] = [],
    issues: string[] = [];
  const pierceMarkers: Plan["pierces"] = [];
  const design = project.parts.map((p) => ({ p, contours: transformed(p) }));
  const paths = project.parts
    .flatMap((p) =>
      transformed(p).flatMap((raw) => {
        const process = p.process ?? project.material;
        const c = {
          ...raw,
          points: raw.points.filter(
            (v, i) => i === 0 || distance(raw.points[i - 1], v) > 1e-8,
          ),
        };
        if (
          c.closed &&
          c.points.length > 1 &&
          distance(c.points[0], c.points[c.points.length - 1]) < 1e-8
        )
          c.points.pop();
        if (
          c.points.length < 2 ||
          (c.closed && Math.abs(area(c.points)) < 1e-8)
        ) {
          issues.push(`${p.name}: degenerate contour skipped.`);
          return [];
        }
        const cutMode = c.cut ?? p.cut;
        const tabTargets = (c.tabs ?? []).map((tab) => ({
          point: pointOnPath(c.points, c.closed, tab.position),
          width: tab.width,
        }));
        const entry =
          c.startPosition === undefined
            ? undefined
            : pointOnPath(c.points, c.closed, c.startPosition);
        const delta =
          cutMode === "centerline"
            ? 0
            : (process.kerf / 2) *
              (cutMode === "outside" ? 1 : -1) *
              (c.cut ? 1 : c.hole ? -1 : 1);
        if (!c.closed && cutMode !== "centerline")
          issues.push(`${p.name}: open contour requires centerline cutting.`);
        const result = offset(c, delta);
        if (!result.length)
          issues.push(`${p.name}: kerf compensation removes a contour.`);
        return result.map((contour) => ({
          p,
          c:
            entry && contour.closed
              ? { ...contour, points: movePathStart(contour.points, entry) }
              : contour,
          tabTargets,
          cutMode,
          process,
        }));
      }),
    )
    .sort(
      (a, b) =>
        Number(b.c.hole) - Number(a.c.hole) ||
        Math.abs(area(a.c.points)) - Math.abs(area(b.c.points)),
    );
  let cursor: Point = { x: 0, y: 0 },
    pierces = 0,
    pierceSeconds = 0;
  for (const { p, c, tabTargets, cutMode, process } of paths) {
    const pts = c.closed ? [...c.points, c.points[0]] : c.points;
    const total = pts.slice(1).reduce((s, v, i) => s + distance(pts[i], v), 0);
    if (total < 0.001) {
      issues.push(`${p.name}: zero-length contour.`);
      continue;
    }
    const n =
        c.tabMode === "none" || c.tabMode === "manual"
          ? 0
          : c.closed && !c.hole
            ? process.tabCount
            : 0,
      tw = process.tabWidth;
    const tabs =
      c.closed && c.tabMode === "manual"
        ? tabTargets.flatMap((tab) => {
            const at = closestOnPath(c.points, true, tab.point).along;
            const start = at - tab.width / 2,
              end = at + tab.width / 2;
            return [0, -total, total]
              .map((shift) => ({ start: start + shift, end: end + shift }))
              .filter((t) => t.end > 0 && t.start < total);
          })
        : Array.from({ length: n }, (_, i) => ({
            start: (total * (i + 0.5)) / n - tw / 2,
            end: (total * (i + 0.5)) / n + tw / 2,
          }));
    if (n * tw >= total) issues.push(`${p.name}: tabs consume the contour.`);
    const tangent = distance(pts[0], pts[1]);
    const lead = cutMode === "centerline" ? 0 : process.lead;
    const start = {
      x: pts[0].x - ((pts[1].x - pts[0].x) / tangent) * lead,
      y: pts[0].y - ((pts[1].y - pts[0].y) / tangent) * lead,
    };
    moves.push({ from: cursor, to: start, kind: "rapid", partId: p.id });
    const radius = (process.pierceDiameter ?? 0) / 2;
    let pierceWarning = false;
    if (process.pierceDiameter === 0)
      issues.push(
        "Pierce diameter is not set; pierce/profile interference has not been checked.",
      );
    if (radius > 0) {
      pierceWarning = design.some(
        (d) =>
          pointInPaths(
            d.contours.filter((c) => c.closed).map((c) => c.points),
            start,
          ) ||
          d.contours.some(
            (c) =>
              closestOnPath(c.points, c.closed, start).distance < radius - 1e-6,
          ),
      );
      if (pierceWarning)
        issues.push(
          `${p.name}: pierce footprint may alter a finished cut profile. Increase lead length or move the entry point.`,
        );
      if (
        start.x - radius < 0 ||
        start.y - radius < 0 ||
        start.x + radius > project.stock.width ||
        start.y + radius > project.stock.height
      )
        issues.push(`${p.name}: pierce footprint extends outside the stock.`);
    }
    pierceMarkers.push({
      point: start,
      radius,
      partId: p.id,
      warning: pierceWarning,
    });
    pierces++;
    pierceSeconds += process.pierce;
    if (lead)
      moves.push({
        from: start,
        to: pts[0],
        kind: "cut",
        partId: p.id,
        feed: process.feed,
      });
    let walked = 0;
    for (let i = 1; i < pts.length; i++) {
      const from = pts[i - 1],
        to = pts[i],
        len = distance(from, to);
      if (len < 1e-9) continue;
      const cuts = [
        0,
        len,
        ...tabs
          .flatMap((t) => [t.start - walked, t.end - walked])
          .filter((d) => d > 0 && d < len),
      ].sort((a, b) => a - b);
      for (let j = 1; j < cuts.length; j++) {
        const at = (d: number) => ({
          x: from.x + ((to.x - from.x) * d) / len,
          y: from.y + ((to.y - from.y) * d) / len,
        });
        const mid = walked + (cuts[j - 1] + cuts[j]) / 2;
        moves.push({
          from: at(cuts[j - 1]),
          to: at(cuts[j]),
          kind: tabs.some((t) => mid >= t.start && mid <= t.end)
            ? "tab"
            : "cut",
          partId: p.id,
          feed: process.feed,
        });
      }
      walked += len;
    }
    cursor = pts[pts.length - 1];
  }
  for (const m of moves.filter((m) => m.kind !== "rapid"))
    if (
      [m.from, m.to].some(
        (p) =>
          p.x < 0 ||
          p.y < 0 ||
          p.x > project.stock.width ||
          p.y > project.stock.height,
      )
    ) {
      issues.push("Compensated toolpath or lead extends outside the stock.");
      break;
    }
  const boxes = project.parts.map((p) => ({ p, b: partBounds(p) }));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      if (
        a.b.x < b.b.x + b.b.width &&
        a.b.x + a.b.width > b.b.x &&
        a.b.y < b.b.y + b.b.height &&
        a.b.y + a.b.height > b.b.y &&
        partsOverlap(a.p, b.p)
      )
        issues.push(
          `${a.p.name} / ${b.p.name}: part material overlaps; inspect geometry.`,
        );
    }
  const cutLength = moves
    .filter((m) => m.kind === "cut")
    .reduce((s, m) => s + distance(m.from, m.to), 0);
  return {
    moves,
    cutLength,
    minutes:
      moves
        .filter((m) => m.kind === "cut")
        .reduce(
          (sum, m) =>
            sum + distance(m.from, m.to) / (m.feed ?? project.material.feed),
          0,
        ) +
      pierceSeconds / 60,
    issues: [...new Set(issues)],
    pierces: pierceMarkers,
  };
}
export function svgExport(project: Project) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${project.stock.width}mm" height="${project.stock.height}mm" viewBox="0 0 ${project.stock.width} ${project.stock.height}">${project.parts
    .map(
      (p) =>
        `<g fill="none" stroke="black" stroke-width="0.1">${transformed(p)
          .map(
            (c) =>
              `<path d="M${c.points.map((v) => `${v.x},${v.y}`).join(" L")}${c.closed ? " Z" : ""}"/>`,
          )
          .join("")}</g>`,
    )
    .join("")}</svg>`;
}

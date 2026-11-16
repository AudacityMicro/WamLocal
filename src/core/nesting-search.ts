import type { Part, Project } from "./model";
import { effectivePierceDiameter } from "./model";
import type { Job } from "./job";

/** Generate one seed per search, including runs started through MCP. */
export function newSearchSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
}

export function processClearance(p: Part, project: Project) {
  const base = p.process ?? project.material,
    process = { ...base, kerf: project.machineSettings?.kerf ?? base.kerf };
  return (
    Math.max(
      0,
      process.kerf / 2,
      effectivePierceDiameter(process) / 2,
      ...p.contours.map((c) =>
        (c.cut ?? p.cut) === "centerline" ? 0 : (c.lead ?? process.lead),
      ),
    ) +
    Math.max(0, p.stockToLeave ?? 0) +
    project.stock.spacing / 2
  );
}

export function searchSettings(nesting?: Project["nesting"]) {
  return {
    rotationStep: 90,
    allowRotation: true,
    budgetSeconds: 30,
    budgetMode: "auto",
    maxAutoSeconds: 300,
    effort: "balanced",
    method: "auto",
    order: "area",
    objective: "compact",
    detail: "normal",
    restarts: 8,
    stallPasses: 3,
    seed: 1,
    allowNewSheets: true,
    maxSheets: 500,
    preservePlaced: false,
    insideHoles: false,
    optimize: false,
    ...nesting,
  } as const;
}

/** A soft budget: geometry operations finish atomically; worker cancellation is immediate. */
export function searchBudget(value: Job | Project, rotate = true) {
  const cfg = searchSettings(value.nesting);
  const copies =
    "sheets" in value
      ? value.parts.reduce((n, p) => n + p.quantity, 0)
      : value.parts.length;
  const vertices = value.parts.reduce(
    (n, p) => n + p.contours.reduce((s, c) => s + c.points.length, 0),
    0,
  );
  const constrained =
    value.parts.some(
      (p) => p.locked || (p.rotationPolicy && p.rotationPolicy !== "free"),
    ) ||
    ("sheets" in value &&
      value.sheets.some(
        (s) =>
          s.placements.some((p) => p.locked) ||
          s.stock.outline ||
          s.stock.exclusions?.length,
      ));
  const factor = { fast: 0.5, balanced: 1, thorough: 2.5 }[cfg.effort];
  const rotations = rotate ? 1 + Math.log2(90 / cfg.rotationStep) / 3 : 1;
  const complexity =
    (5 + copies * 0.18 + value.parts.length * 0.5 + vertices * 0.0015) *
    factor *
    rotations *
    (cfg.insideHoles || constrained ? 1.4 : 1);
  const capMs =
    (cfg.budgetMode === "fixed" ? cfg.budgetSeconds : cfg.maxAutoSeconds) *
    1000;
  const initialMs =
    cfg.budgetMode === "fixed"
      ? capMs
      : Math.min(capMs, Math.max(2000, Math.ceil(complexity) * 1000));
  return {
    initialMs,
    capMs,
    copies,
    vertices,
    automatic: cfg.budgetMode !== "fixed",
  };
}

export function createSearchClock(
  budget: ReturnType<typeof searchBudget>,
  now = () => Date.now(),
) {
  const start = now();
  let limit = budget.initialMs,
    extensions = 0,
    lastExtendedAt = -1;
  return {
    remaining: () => Math.max(0, start + limit - now()),
    elapsed: () => Math.max(0, now() - start),
    get limitMs() {
      return limit;
    },
    get extensions() {
      return extensions;
    },
    extendOnProgress(placed: number) {
      if (
        !budget.automatic ||
        placed <= lastExtendedAt ||
        limit >= budget.capMs ||
        start + limit - now() > Math.max(1000, budget.initialMs * 0.15)
      )
        return false;
      limit = Math.min(
        budget.capMs,
        limit + Math.max(2000, Math.min(15000, budget.initialMs * 0.5)),
      );
      extensions++;
      lastExtendedAt = placed;
      return true;
    },
  };
}

function size(p: Part) {
  const a = (p.rotation * Math.PI) / 180;
  const cos = Math.cos(a),
    sin = Math.sin(a);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    perimeter = 0,
    area = 0;
  for (const c of p.contours) {
    let signedArea = 0;
    for (let i = 0; i < c.points.length; i++) {
      const v = c.points[i],
        q = c.points[(i + 1) % c.points.length];
      const x = p.scale * (v.x * cos - v.y * sin) + p.x,
        y = p.scale * (v.x * sin + v.y * cos) + p.y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (c.closed || i < c.points.length - 1)
        perimeter += Math.hypot(v.x - q.x, v.y - q.y) * p.scale;
      if (c.closed) signedArea += v.x * q.y - q.x * v.y;
    }
    area += ((c.hole ? -1 : 1) * Math.abs(signedArea) * p.scale * p.scale) / 2;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    perimeter,
    area,
  };
}
export function orderParts(
  parts: Part[],
  order: ReturnType<typeof searchSettings>["order"],
  trial = 0,
  seed = 1,
) {
  const metrics = new Map(parts.map((p) => [p.id, size(p)]));
  const ranked = parts.map((p, i) => ({ p, i, m: metrics.get(p.id)! }));
  if (order !== "input")
    ranked.sort((a, b) => {
      const score = (v: typeof a) =>
        order === "longest"
          ? Math.max(v.m.width, v.m.height)
          : order === "perimeter"
            ? v.m.perimeter
            : v.m.area || v.m.width * v.m.height;
      return score(b) - score(a) || a.i - b.i;
    });
  const out = ranked.map((v) => v.p);
  if (trial === 1) return out.reverse();
  if (trial > 1) {
    let state = (seed + trial * 2654435761) >>> 0;
    for (let i = out.length - 1; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}
export function layoutScore(
  parts: Part[],
  objective: ReturnType<typeof searchSettings>["objective"],
) {
  if (!parts.length) return 0;
  const m = parts.map(size),
    w = Math.max(...m.map((v) => v.maxX)) - Math.min(...m.map((v) => v.minX)),
    h = Math.max(...m.map((v) => v.maxY)) - Math.min(...m.map((v) => v.minY));
  return objective === "height"
    ? h * 10000 + w
    : objective === "width"
      ? w * 10000 + h
      : w * h;
}

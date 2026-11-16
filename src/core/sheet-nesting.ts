import type { Project } from "./model";
import { packSheet } from "./nesting";
import {
  createSearchClock,
  layoutScore,
  orderParts,
  searchBudget,
  searchSettings,
  newSearchSeed,
} from "./nesting-search";
import type { NestingProgress } from "./job-nesting";

export function nestSheetDetailed(
  project: Project,
  rotate = project.nesting?.allowRotation ?? true,
  onProgress?: (progress: NestingProgress, checkpoint?: Project) => void,
) {
  project = {
    ...project,
    nesting: { ...searchSettings(project.nesting), seed: newSearchSeed() },
  };
  const cfg = searchSettings(project.nesting),
    budget = searchBudget(project, rotate),
    clock = createSearchClock(budget);
  let best: Project = { ...project, parts: [] },
    bestScore = Infinity,
    improvement = 0,
    pass = 0,
    stalls = 0;
  try {
    packSheet(
      { ...project, parts: project.parts.map((p) => ({ ...p, locked: true })) },
      rotate,
      0,
    );
    best = project;
    bestScore = layoutScore(best.parts, cfg.objective);
  } catch {}
  const emit = (phase: string) =>
    onProgress?.(
      {
        phase,
        placed: best.parts.length,
        total: project.parts.length,
        sheets: 1,
        pass,
        elapsedMs: clock.elapsed(),
        budgetMs: clock.limitMs,
        capMs: budget.capMs,
        extensions: clock.extensions,
      },
      best.parts.length ? best : undefined,
    );
  emit("Preparing sheet search");
  const passes = cfg.optimize ? cfg.restarts : Math.min(3, cfg.restarts);
  for (pass = 1; pass <= passes && clock.remaining() > 0; pass++) {
    const trial = {
      ...project,
      parts: orderParts(project.parts, cfg.order, pass - 1, cfg.seed),
    };
    const packed = packSheet(
      trial,
      rotate,
      Math.min(clock.remaining(), Math.max(1000, budget.initialMs / passes)),
    );
    const score = layoutScore(packed.parts, cfg.objective);
    if (
      packed.parts.length > best.parts.length ||
      (packed.parts.length === best.parts.length && score < bestScore)
    ) {
      best = {
        ...project,
        parts: project.parts.flatMap(
          (p) => packed.parts.find((v) => v.id === p.id) ?? [],
        ),
      };
      bestScore = score;
      stalls = 0;
      clock.extendOnProgress(++improvement);
      emit("Best sheet layout improved");
    } else stalls++;
    if (
      (best.parts.length === project.parts.length && !cfg.optimize) ||
      stalls >= cfg.stallPasses
    )
      break;
  }
  return {
    value: best,
    report: {
      placed: best.parts.length,
      total: project.parts.length,
      unplaced: [{ quantity: project.parts.length - best.parts.length }],
      timedOut: clock.remaining() <= 0,
      reason:
        best.parts.length === project.parts.length ? "complete" : "stalled",
      elapsedMs: clock.elapsed(),
      budgetMs: clock.limitMs,
      capMs: budget.capMs,
      extensions: clock.extensions,
      passes: Math.min(pass, passes),
      seed: cfg.seed,
    },
  };
}

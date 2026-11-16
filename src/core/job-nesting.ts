import { id, type Part, type Project } from "./model";
import {
  jobSchema,
  definitionContours,
  materialsCompatible,
  type Job,
  type Sheet,
} from "./job";
import { packSheet } from "./nesting";
import { bounds } from "./geometry";
import {
  searchSettings,
  searchBudget,
  createSearchClock,
  orderParts,
  layoutScore,
  newSearchSeed,
} from "./nesting-search";

export type NestingProgress = {
  phase: string;
  placed: number;
  total: number;
  sheets: number;
  pass: number;
  elapsedMs: number;
  budgetMs: number;
  capMs: number;
  extensions: number;
};
export type JobNestingReport = {
  job: Job;
  placed: number;
  total: number;
  unplaced: { partId: string; name: string; quantity: number }[];
  timedOut: boolean;
  reason: "complete" | "budget" | "stalled" | "sheet-limit";
  elapsedMs: number;
  budgetMs: number;
  capMs: number;
  extensions: number;
  passes: number;
  seed: number;
};
type Options = {
  onProgress?: (progress: NestingProgress, checkpoint?: Job) => void;
  now?: () => number;
};
type Placement = Sheet["placements"][number];

/** Pack batches per sheet, keeping a validated incumbent rather than repacking every copy. */
export function nestJobDetailed(
  job: Job,
  rotate?: boolean,
  options: Options = {},
): JobNestingReport {
  job = {
    ...job,
    nesting: { ...searchSettings(job.nesting), seed: newSearchSeed() },
  };
  const cfg = searchSettings(job.nesting);
  if (job.parts.reduce((n, p) => n + p.quantity, 0) > 20000)
    throw Error(
      "A job can contain at most 20,000 placed copies. Split larger quantities into separate jobs.",
    );
  rotate ??= cfg.allowRotation;
  const budget = searchBudget(job, rotate),
    clock = createSearchClock(budget, options.now);
  const materials = new Map(job.materials.map((m) => [m.id, m]));
  const process = (materialId: string) => ({
    ...materials.get(materialId)!,
    ...(job.machineSettings
      ? {
          kerf: job.machineSettings.kerf,
          abrasive: job.machineSettings.abrasive,
        }
      : {}),
  });
  const definitions = new Map(
    job.parts.map((p) => [
      p.id,
      { ...p, contours: definitionContours(p), process: process(p.materialId) },
    ]),
  );
  for (const p of job.parts)
    if (!p.contours.length) throw Error(`${p.name}: no geometry to nest`);
  const retained = new Map(
    job.sheets.map((s) => [
      s.id,
      s.placements.filter((p) => p.locked || cfg.preservePlaced),
    ]),
  );
  const originalPlacements = new Map(
    job.sheets.flatMap((s) => s.placements.map((p) => [p.id, p] as const)),
  );
  const entries: Placement[] = [];
  for (const p of job.parts) {
    const kept = [...retained.values()]
      .flat()
      .filter((i) => i.partId === p.id).length;
    const free = job.sheets
      .flatMap((s) => s.placements)
      .filter((i) => i.partId === p.id && !i.locked && !cfg.preservePlaced);
    for (let i = 0; i < p.quantity - kept; i++)
      entries.push(
        free[i] ?? {
          id: id(),
          partId: p.id,
          x: 0,
          y: 0,
          rotation: 0,
          scale: 1,
        },
      );
  }
  const entriesById = new Map(entries.map((e) => [e.id, e]));
  const instances = new Map<string, Part>();
  const asPart = (entry: Placement, locked = false): Part => {
    const def = definitions.get(entry.partId)!;
    return { ...def, ...entry, definitionId: def.id, locked };
  };
  for (const e of entries) instances.set(e.id, asPart(e));
  const projectFor = (sheet: Sheet, parts: Part[]): Project => ({
    version: 1,
    name: job.name,
    machine: job.machine,
    machineSettings: job.machineSettings,
    bedOffset: sheet.wcs,
    stock: sheet.stock,
    material: process(sheet.materialId),
    nesting: job.nesting,
    parts,
  });
  const total = job.parts.reduce((n, p) => n + p.quantity, 0);
  let best: Job = {
    ...job,
    sheets: job.sheets.map((s) => ({
      ...s,
      placements: [...retained.get(s.id)!],
    })),
  };
  let bestCount = best.sheets.reduce((n, s) => n + s.placements.length, 0),
    bestSheets = Infinity,
    bestScore = Infinity;
  let pass = 0,
    stalled = 0,
    lastCheckpoint = -Infinity,
    improvement = 0;
  const progress = (phase: string, checkpoint?: Job) => {
    const now = clock.elapsed();
    if (checkpoint && now - lastCheckpoint < 200 && bestCount !== total) return;
    if (checkpoint) lastCheckpoint = now;
    options.onProgress?.(
      {
        phase,
        placed: bestCount,
        total,
        sheets: best.sheets.filter((s) => s.placements.length).length,
        pass,
        elapsedMs: now,
        budgetMs: clock.limitMs,
        capMs: budget.capMs,
        extensions: clock.extensions,
      },
      checkpoint,
    );
  };
  progress("Preparing geometry");
  // Validate locked placements once; existing valid layouts are eligible incumbents.
  for (const s of job.sheets) {
    const fixed = retained.get(s.id)!;
    if (fixed.length)
      packSheet(
        projectFor(
          s,
          fixed.map((e) => asPart(e, true)),
        ),
        rotate,
        0,
      );
  }
  const consider = (candidate: Job) => {
    const count = candidate.sheets.reduce((n, s) => n + s.placements.length, 0),
      used = candidate.sheets.filter((s) => s.placements.length),
      score = used.reduce(
        (n, s) =>
          n +
          layoutScore(
            s.placements.map((e) => asPart(e)),
            cfg.objective,
          ),
        0,
      );
    if (
      count > bestCount ||
      (count === bestCount &&
        (used.length < bestSheets ||
          (used.length === bestSheets && score < bestScore)))
    ) {
      best = candidate;
      bestCount = count;
      bestSheets = used.length;
      bestScore = score;
      clock.extendOnProgress(++improvement);
      progress("Best layout improved", best);
      return true;
    }
    return false;
  };
  if (job.sheets.some((s) => s.placements.length)) {
    try {
      for (const s of job.sheets)
        if (s.placements.length)
          packSheet(
            projectFor(
              s,
              s.placements.map((e) => asPart(e, true)),
            ),
            rotate,
            0,
          );
      consider(job);
    } catch {
      /* Rebuild invalid free placements; locked errors were checked above. */
    }
  }
  const passes = cfg.optimize ? cfg.restarts : Math.min(3, cfg.restarts);
  for (pass = 1; pass <= passes && clock.remaining() > 0; pass++) {
    let work: Job = {
      ...job,
      sheets: job.sheets.map((s) => ({
        ...s,
        placements: [...retained.get(s.id)!],
      })),
    };
    let remaining = orderParts(
      [...instances.values()],
      cfg.order,
      pass - 1,
      cfg.seed,
    ).map((p) => entriesById.get(p.id)!);
    let improved = false;
    let lastTimedOut = false,
      lastBatch: string[] = [],
      coverage = 0;
    const attempted = new Map<string, Set<string>>();
    const signature = (e: Placement) => `${e.partId}|${e.scale}|${e.rotation}`;
    const compatible = (e: Placement, s: Sheet) =>
      materialsCompatible(
        materials.get(definitions.get(e.partId)!.materialId),
        materials.get(s.materialId),
      );
    const fill = (sheet: Sheet): boolean => {
      lastTimedOut = false;
      lastBatch = [];
      if (clock.remaining() <= 0) return false;
      const room = 2000 - sheet.placements.length;
      if (room <= 0) return false;
      const tried = attempted.get(sheet.id) ?? new Set<string>();
      attempted.set(sheet.id, tried);
      let pool = remaining.filter(
        (e) => compatible(e, sheet) && !tried.has(signature(e)),
      );
      const sheetMaterial = materials.get(sheet.materialId)!;
      const unusedPlaceholder =
        !sheet.placements.length &&
        !sheetMaterial.stockKey &&
        /^Custom material/i.test(sheetMaterial.name) &&
        ["User defaults", "Migrated job material"].includes(
          sheetMaterial.source ?? "",
        ) &&
        !job.parts.some((p) =>
          materialsCompatible(materials.get(p.materialId), sheetMaterial),
        ) &&
        !sheet.stock.outline &&
        !sheet.stock.exclusions?.length;
      if (!pool.length && unusedPlaceholder && remaining.length) {
        sheet = {
          ...sheet,
          materialId: definitions.get(remaining[0].partId)!.materialId,
        };
        pool = remaining.filter(
          (e) => compatible(e, sheet) && !tried.has(signature(e)),
        );
      }
      if (!pool.length) return false;
      const averageVertices =
        pool
          .slice(0, 24)
          .reduce(
            (n, e) =>
              n +
              instances
                .get(e.id)!
                .contours.reduce((s, c) => s + c.points.length, 0),
            0,
          ) / Math.min(pool.length, 24);
      const dimensions = pool
        .slice(0, 24)
        .map((e) => {
          const b = bounds(
            definitions.get(e.partId)!.contours.flatMap((c) => c.points),
          );
          return Math.max(1, b.width * b.height);
        })
        .sort((a, b) => a - b);
      const capacity = Math.ceil(
        (sheet.stock.width * sheet.stock.height) /
          dimensions[Math.floor(dimensions.length / 2)],
      );
      const limit = Math.max(
        1,
        Math.min(
          room,
          Math.ceil(capacity * 2),
          Math.floor(120000 / Math.max(1, averageVertices)),
        ),
      );
      // Reserve a fraction of the batch for small filler parts.
      const head = pool.slice(0, Math.max(1, Math.floor(limit * 0.8))),
        selected = new Set(head.map((e) => e.id));
      const tail = [...pool]
        .reverse()
        .filter((e) => !selected.has(e.id))
        .slice(0, Math.max(0, limit - head.length));
      const batch = [...head, ...tail];
      lastBatch = batch.map(signature);
      const fixed = sheet.placements.map((e) => asPart(e, true));
      const slice = Math.min(
        clock.remaining(),
        { fast: 250, balanced: 2000, thorough: 6000 }[cfg.effort],
      );
      progress(`Packing ${sheet.name}`);
      const trial = projectFor(sheet, [
        ...fixed,
        ...batch.map((e) => instances.get(e.id)!),
      ]);
      // Job-level passes vary order; sheet search gets one pass from the shared budget.
      trial.nesting = {
        ...trial.nesting,
        rotationStep: cfg.rotationStep,
        budgetSeconds: cfg.budgetSeconds,
        insideHoles: cfg.insideHoles,
        optimize: false,
        order: pass === 1 ? cfg.order : "input",
        seed: cfg.seed + pass,
      };
      const packed = packSheet(trial, rotate, slice);
      lastTimedOut = packed.timedOut;
      if (!lastTimedOut) for (const key of lastBatch) tried.add(key);
      const newParts = packed.parts.filter(
        (p) => !sheet.placements.some((e) => e.id === p.id),
      );
      if (!newParts.length) return false;
      const placements: Placement[] = [
        ...sheet.placements,
        ...newParts.map((p) => ({
          id: p.id,
          partId: p.definitionId!,
          x: p.x,
          y: p.y,
          rotation: p.rotation,
          scale: p.scale,
          locked: originalPlacements.get(p.id)?.locked,
        })),
      ];
      work = {
        ...work,
        sheets: work.sheets.some((s) => s.id === sheet.id)
          ? work.sheets.map((s) =>
              s.id === sheet.id ? { ...sheet, placements } : s,
            )
          : [...work.sheets, { ...sheet, placements }],
      };
      const used = new Set(newParts.map((p) => p.id));
      remaining = remaining.filter((e) => !used.has(e.id));
      const count = work.sheets.reduce((n, s) => n + s.placements.length, 0);
      if (count > coverage) {
        coverage = count;
        clock.extendOnProgress(++improvement);
      }
      improved = consider(work) || improved;
      return true;
    };
    const refill = (sheet: Sheet) => {
      let filled = false,
        failures = 0;
      while (remaining.length && clock.remaining() > 0) {
        const before = attempted.get(sheet.id)?.size ?? 0;
        const found = fill(work.sheets.find((s) => s.id === sheet.id) ?? sheet);
        filled = found || filled;
        if (lastTimedOut) {
          if (found) {
            failures = 0;
            continue;
          }
          if (++failures < 2) continue;
          for (const key of lastBatch) attempted.get(sheet.id)?.add(key);
        }
        if (!found && (attempted.get(sheet.id)?.size ?? 0) === before) break;
      }
      return filled;
    };
    for (const sheet of work.sheets) {
      if (!remaining.length || clock.remaining() <= 0) break;
      refill(sheet);
    }
    while (
      remaining.length &&
      clock.remaining() > 0 &&
      cfg.allowNewSheets &&
      work.sheets.length < cfg.maxSheets &&
      work.sheets.length < 500
    ) {
      const first = remaining[0],
        materialId = definitions.get(first.partId)!.materialId;
      const matching = job.sheets.filter((s) => compatible(first, s)),
        templates = (matching.length ? matching : job.sheets)
          .slice()
          .sort(
            (a, b) =>
              b.stock.width * b.stock.height - a.stock.width * a.stock.height,
          );
      const seen = new Set<string>();
      let fitted = false;
      for (const template of templates) {
        const key = JSON.stringify([template.stock, template.wcs]);
        if (seen.has(key)) continue;
        seen.add(key);
        const sheet: Sheet = {
          ...template,
          id: id(),
          name: `Sheet ${work.sheets.length + 1}`,
          materialId,
          placements: [],
        };
        if (refill(sheet)) {
          fitted = true;
          break;
        }
        if (clock.remaining() <= 0) break;
      }
      if (!fitted) {
        // Try another material/shape instead of blocking the entire batch.
        const rejected = remaining.filter((e) => e.partId === first.partId);
        remaining = remaining.filter((e) => e.partId !== first.partId);
        if (!remaining.length) break;
        // Keep rejected instances unplaced in the final report; do not spin on them.
        if (!rejected.length) break;
      }
    }
    if (bestCount === total && !cfg.optimize) break;
    if (improved) stalled = 0;
    else stalled++;
    if (stalled >= cfg.stallPasses) break;
  }
  const placedCounts = new Map<string, number>();
  for (const s of best.sheets)
    for (const p of s.placements)
      placedCounts.set(p.partId, (placedCounts.get(p.partId) ?? 0) + 1);
  const unplaced = job.parts.flatMap((p) => {
    const quantity = p.quantity - (placedCounts.get(p.id) ?? 0);
    return quantity > 0 ? [{ partId: p.id, name: p.name, quantity }] : [];
  });
  const timedOut = clock.remaining() <= 0;
  const report: JobNestingReport = {
    job: jobSchema.parse(best),
    placed: bestCount,
    total,
    unplaced,
    timedOut,
    reason: unplaced.length
      ? timedOut
        ? "budget"
        : !cfg.allowNewSheets || best.sheets.length >= cfg.maxSheets
          ? "sheet-limit"
          : "stalled"
      : "complete",
    elapsedMs: clock.elapsed(),
    budgetMs: clock.limitMs,
    capMs: budget.capMs,
    extensions: clock.extensions,
    passes: Math.min(pass, passes),
    seed: cfg.seed,
  };
  progress(
    unplaced.length ? "Best available layout ready" : "All copies placed",
    report.job,
  );
  return report;
}

export function nestJob(job: Job, rotate?: boolean): Job {
  return nestJobDetailed(job, rotate).job;
}

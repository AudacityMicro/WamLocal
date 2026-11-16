import { describe, it, expect } from "vitest";
import {
  newProject,
  makePart,
  rectangle,
  circle,
  projectSchema,
} from "./model";
import { readJob, jobSchema, placedCount } from "./job";
import { nestJobDetailed } from "./job-nesting";
import { packSheet, partsOverlap } from "./nesting";
import { searchBudget, createSearchClock, orderParts } from "./nesting-search";
import { nestSheetDetailed } from "./sheet-nesting";

function batch(quantity = 10) {
  const p = newProject();
  p.stock = { width: 100, height: 70, margin: 2, spacing: 2 };
  p.material = {
    ...p.material,
    kerf: 0,
    lead: 0,
    pierceDiameter: 0,
    tabCount: 0,
  };
  p.parts = [makePart("plate", [rectangle(30, 20)])];
  const j = readJob(p);
  j.parts[0].quantity = quantity;
  j.sheets[0].placements = [];
  j.nesting = {
    rotationStep: 90,
    budgetSeconds: 1,
    budgetMode: "auto",
    effort: "fast",
    method: "bounds",
    insideHoles: false,
    optimize: false,
  };
  return j;
}
describe("adaptive nesting time", () => {
  it("scales automatic time with copies, geometry, rotations and effort", () => {
    const a = batch(1),
      b = batch(200);
    expect(searchBudget(b).initialMs).toBeGreaterThan(
      searchBudget(a).initialMs,
    );
    const before = searchBudget(b).initialMs;
    b.parts[0].contours[0].points = Array.from({ length: 1000 }, (_, i) => ({
      x: 20 + 10 * Math.cos((i / 1000) * 2 * Math.PI),
      y: 20 + 10 * Math.sin((i / 1000) * 2 * Math.PI),
    }));
    b.nesting = { ...b.nesting!, rotationStep: 15, effort: "thorough" };
    expect(searchBudget(b).initialMs).toBeGreaterThan(before);
    b.nesting.maxAutoSeconds = 5;
    expect(searchBudget(b).initialMs).toBe(5000);
  });
  it("extends only after improvement near the deadline and never exceeds the cap", () => {
    let now = 0;
    const c = createSearchClock(
      {
        initialMs: 2000,
        capMs: 6000,
        automatic: true,
        copies: 10,
        vertices: 40,
      },
      () => now,
    );
    expect(c.extendOnProgress(1)).toBe(false);
    now = 1500;
    expect(c.extendOnProgress(1)).toBe(true);
    expect(c.limitMs).toBe(4000);
    now = 3500;
    expect(c.extendOnProgress(1)).toBe(false);
    expect(c.extendOnProgress(2)).toBe(true);
    expect(c.limitMs).toBe(6000);
    now = 5500;
    expect(c.extendOnProgress(3)).toBe(false);
  });
  it("honors a fixed shared limit even with improvement", () => {
    const j = batch(100);
    j.nesting = { ...j.nesting!, budgetMode: "fixed", budgetSeconds: 3 };
    const budget = searchBudget(j);
    expect(budget.initialMs).toBe(3000);
    expect(budget.capMs).toBe(3000);
    let now = 2900;
    const clock = createSearchClock(budget, () => now);
    now = 5800;
    expect(clock.extendOnProgress(1)).toBe(false);
    expect(clock.limitMs).toBe(3000);
  });
});
describe("batch job nesting", () => {
  it("packs hundreds of requested copies in batches rather than one repack per copy", () => {
    const j = batch(1000);
    j.nesting!.method = "auto";
    j.nesting!.effort = "balanced";
    j.nesting!.maxAutoSeconds = 5;
    j.sheets[0].stock = { width: 200, height: 150, margin: 2, spacing: 2 };
    let searches = 0;
    const report = nestJobDetailed(j, true, {
      onProgress: (p) => {
        if (p.phase.startsWith("Packing")) searches++;
      },
    });
    expect(report.placed).toBe(1000);
    expect(report.unplaced).toEqual([]);
    expect(searches).toBeLessThan(50);
    expect(j.sheets[0].placements).toEqual([]);
    expect(() => jobSchema.parse(report.job)).not.toThrow();
  });
  it("returns a useful partial layout when the shared time expires", () => {
    const j = batch(5);
    j.sheets[0].stock = { width: 40, height: 30, margin: 2, spacing: 0 };
    j.nesting = { ...j.nesting!, budgetMode: "fixed", budgetSeconds: 1 };
    let now = 0;
    const checkpoints: number[] = [];
    const result = nestJobDetailed(j, true, {
      now: () => now,
      onProgress: (p, checkpoint) => {
        if (checkpoint && p.placed > 0) {
          checkpoints.push(p.placed);
          now = 1100;
        }
      },
    });
    expect(result.timedOut).toBe(true);
    expect(result.reason).toBe("budget");
    expect(result.placed).toBe(1);
    expect(result.unplaced[0].quantity).toBe(4);
    expect(checkpoints).toContain(1);
    expect(j.sheets[0].placements).toEqual([]);
  });
  it("reports remaining quantities without throwing when new sheets are disabled", () => {
    const j = batch(3);
    j.sheets[0].stock = { width: 40, height: 30, margin: 2, spacing: 0 };
    j.nesting!.allowNewSheets = false;
    const r = nestJobDetailed(j);
    expect(r.placed).toBe(1);
    expect(r.reason).toBe("sheet-limit");
    expect(r.job.sheets).toHaveLength(1);
    expect(r.unplaced[0].quantity).toBe(2);
    expect(r.job.parts[0].quantity).toBe(3);
  });
  it("respects the total sheet ceiling", () => {
    const j = batch(5);
    j.sheets[0].stock = { width: 40, height: 30, margin: 2, spacing: 0 };
    j.nesting!.maxSheets = 2;
    const r = nestJobDetailed(j);
    expect(r.placed).toBe(2);
    expect(r.job.sheets).toHaveLength(2);
    expect(r.unplaced[0].quantity).toBe(3);
  });
  it("keeps existing placements when requested without turning them into permanent locks", () => {
    const j = batch(2),
      p = {
        id: "kept",
        partId: j.parts[0].id,
        x: 5,
        y: 5,
        rotation: 0,
        scale: 1,
      };
    j.sheets[0].placements = [p];
    j.nesting!.preservePlaced = true;
    const r = nestJobDetailed(j);
    expect(r.placed).toBe(2);
    expect(r.job.sheets[0].placements.find((x) => x.id === "kept")).toEqual(p);
  });
  it("rejects invalid locked layouts instead of moving or silently dropping locks", () => {
    const j = batch(2);
    j.sheets[0].placements = [
      {
        id: "bad",
        partId: j.parts[0].id,
        x: 99,
        y: 69,
        rotation: 0,
        scale: 1,
        locked: true,
      },
    ];
    expect(() => nestJobDetailed(j)).toThrow(/Locked/);
  });
  it("retains a better existing layout if the search expires before replacing it", () => {
    const j = batch(1);
    j.sheets[0].placements = [
      {
        id: "existing",
        partId: j.parts[0].id,
        x: 5,
        y: 5,
        rotation: 0,
        scale: 1,
      },
    ];
    j.nesting!.budgetMode = "fixed";
    let now = 0;
    const r = nestJobDetailed(j, true, {
      now: () => now,
      onProgress: (p) => {
        if (p.phase === "Preparing geometry") now = 1100;
      },
    });
    expect(r.placed).toBe(1);
    expect(r.job.sheets[0].placements).toEqual(j.sheets[0].placements);
  });
  it("reports oversized parts as unplaced rather than claiming no solution is possible", () => {
    const j = batch(1);
    j.parts[0].contours = [rectangle(300, 300)];
    const r = nestJobDetailed(j);
    expect(r.placed).toBe(0);
    expect(r.unplaced).toEqual([
      { partId: j.parts[0].id, name: "plate", quantity: 1 },
    ]);
    expect(r.job.sheets).toHaveLength(1);
  });
  it("preserves instance scaling and fixed rotations while arranging copies", () => {
    const j = batch(2);
    j.parts[0].rotationPolicy = "fixed";
    j.sheets[0].stock = { width: 200, height: 150, margin: 2, spacing: 2 };
    j.sheets[0].placements = [
      {
        id: "scaled",
        partId: j.parts[0].id,
        x: 3,
        y: 3,
        rotation: 17,
        scale: 1.5,
      },
    ];
    const r = nestJobDetailed(j);
    expect(placedCount(r.job, j.parts[0].id)).toBe(2);
    const p = r.job.sheets
      .flatMap((s) => s.placements)
      .find((p) => p.id === "scaled")!;
    expect(p.rotation).toBe(17);
    expect(p.scale).toBe(1.5);
  });
});
describe("placement quality and saved controls", () => {
  it("uses contour lead overrides instead of reserving an unused part lead default", () => {
    const p = newProject();
    p.stock = { width: 90, height: 20, margin: 0, spacing: 0 };
    p.material = { ...p.material, kerf: 0, lead: 8 };
    p.parts = [
      makePart("first", [{ ...rectangle(40, 10), lead: 0 }]),
      makePart("second", [{ ...rectangle(40, 10), lead: 0 }]),
    ];
    expect(packSheet(p, false).unplaced).toEqual([]);
  });
  it("can reuse SVGnest circle placements as fixed geometry in subsequent passes", () => {
    const p = newProject();
    p.stock = { width: 200, height: 150, margin: 2, spacing: 2 };
    p.material = { ...p.material, kerf: 0.9652, lead: 1 };
    p.parts = Array.from({ length: 30 }, () =>
      makePart("circle", [circle(15)]),
    );
    const result = packSheet(p, true, 200);
    expect(result.parts.length).toBeGreaterThan(0);
    p.parts = result.parts.map((p) => ({ ...p, locked: true }));
    expect(packSheet(p, true, 0).parts).toHaveLength(result.parts.length);
  });
  it("reserves process clearance per part instead of applying the largest lead everywhere", () => {
    const p = newProject();
    p.stock = { width: 100, height: 30, margin: 0, spacing: 0 };
    p.material = { ...p.material, kerf: 0, lead: 0 };
    p.parts = [
      {
        ...makePart("large lead", [rectangle(40, 10)]),
        process: { ...p.material, lead: 8 },
      },
      makePart("small", [rectangle(40, 10)]),
    ];
    const r = packSheet(p, false);
    expect(r.unplaced).toEqual([]);
    expect(partsOverlap(r.parts[0], r.parts[1])).toBe(false);
  });
  it("honors keep-out geometry even without an irregular stock outline", () => {
    const p = newProject();
    p.stock = {
      width: 30,
      height: 30,
      margin: 0,
      spacing: 0,
      exclusions: [rectangle(30, 30).points],
    };
    p.parts = [makePart("blocked", [rectangle(5, 5)])];
    expect(packSheet(p, true, 50).parts).toEqual([]);
  });
  it("uses true material area for ordering and reproducible seeded restarts", () => {
    const a = makePart("small", [rectangle(10, 10)]),
      b = makePart("large", [rectangle(20, 20)]);
    expect(orderParts([a, b], "area")[0].id).toBe(b.id);
    const parts = Array.from({ length: 10 }, (_, i) => ({
      ...a,
      id: String(i),
    }));
    expect(orderParts(parts, "input", 3, 42).map((p) => p.id)).toEqual(
      orderParts(parts, "input", 3, 42).map((p) => p.id),
    );
    expect(orderParts(parts, "input", 3, 42).map((p) => p.id)).not.toEqual(
      orderParts(parts, "input", 3, 43).map((p) => p.id),
    );
  });
  it("serializes the new controls and accepts earlier saved nesting settings", () => {
    const j = batch();
    j.nesting = {
      ...j.nesting!,
      maxAutoSeconds: 600,
      order: "perimeter",
      objective: "height",
      detail: "fine",
      restarts: 12,
      seed: 42,
      preservePlaced: true,
    };
    expect(jobSchema.parse(JSON.parse(JSON.stringify(j))).nesting).toEqual(
      j.nesting,
    );
    expect(() =>
      projectSchema.parse({
        ...newProject(),
        nesting: {
          rotationStep: 90,
          budgetSeconds: 15,
          insideHoles: false,
          optimize: false,
        },
      }),
    ).not.toThrow();
  });
  it("keeps a valid sheet layout when a proposed search fits fewer parts", () => {
    const p = newProject();
    p.stock = { width: 100, height: 70, margin: 2, spacing: 0 };
    p.material = { ...p.material, kerf: 0, lead: 0 };
    p.parts = [
      makePart("one", [rectangle(20, 20)], 3, 3),
      makePart("two", [rectangle(20, 20)], 30, 3),
    ];
    p.nesting = {
      rotationStep: 90,
      budgetSeconds: 1,
      budgetMode: "fixed",
      method: "bounds",
      insideHoles: false,
      optimize: false,
    };
    const r = nestSheetDetailed(p);
    expect(r.value.parts).toHaveLength(2);
    expect(r.report.unplaced[0].quantity).toBe(0);
  });
});

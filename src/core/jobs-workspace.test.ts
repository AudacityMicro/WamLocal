import { describe, it, expect, vi } from "vitest";
import { newProject, rectangle, makePart, projectSchema } from "./model";
import { newJob, readJob, jobSchema } from "./job";
import { gaugesFor } from "./material-gauges";
import { rotationAngles } from "./advanced-nesting";
import { nestJobDetailed } from "./job-nesting";
import { nestSheetDetailed } from "./sheet-nesting";
import {
  duplicateSheetPlacement,
  removeSheetPlacement,
  updateSheetPlacement,
} from "./sheet-placement";
import * as nesting from "./nesting";

const smallJob = () => {
  const p = newProject();
  p.stock = { width: 100, height: 70, margin: 2, spacing: 2 };
  p.material = { ...p.material, lead: 0, kerf: 0 };
  p.parts = [makePart("part", [rectangle(30, 20)], 3, 3)];
  const j = readJob(p);
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
};
describe("complete gauges and rotation controls", () => {
  it("includes every gauge from 7 through 26, including distinct 11ga steel thicknesses", () => {
    for (const name of ["Mild steel", "Stainless steel", "Aluminum - 6061"])
      expect(gaugesFor(name).map((g) => g.gauge)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 7),
      );
    expect(gaugesFor("Mild steel").find((g) => g.gauge === 11)?.inches).toBe(
      0.1196,
    );
    expect(
      gaugesFor("Stainless steel").find((g) => g.gauge === 11)?.inches,
    ).toBe(0.125);
  });
  it("accepts one-degree and arbitrary integer steps without omitting the final angle", () => {
    const p = makePart("angle", [rectangle()]);
    expect(rotationAngles(p, 1, true)).toHaveLength(360);
    expect(rotationAngles(p, 7, true).at(-1)).toBe(357);
    for (const step of [1, 2, 7, 90])
      expect(() =>
        projectSchema.parse({
          ...newProject(),
          nesting: { rotationStep: step },
        }),
      ).not.toThrow();
    for (const step of [0, 0.5, 91])
      expect(() =>
        projectSchema.parse({
          ...newProject(),
          nesting: { rotationStep: step },
        }),
      ).toThrow();
  });
  it("generates a fresh recorded seed on every job and sheet search", () => {
    const j = smallJob();
    j.nesting!.seed = 42;
    let value = 100;
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation(((
      array: Uint32Array,
    ) => {
      array[0] = ++value;
      return array;
    }) as typeof crypto.getRandomValues);
    try {
      const a = nestJobDetailed(j),
        b = nestJobDetailed(j);
      expect(a.seed).toBe(101);
      expect(b.seed).toBe(102);
      expect(b.job.nesting?.seed).toBe(102);
      expect(j.nesting!.seed).toBe(42);
      const p = newProject();
      p.parts = [makePart("part", [rectangle(10, 10)], 20, 20)];
      expect(nestSheetDetailed(p).report.seed).toBe(103);
    } finally {
      random.mockRestore();
    }
  });
});
describe("sheet placement operations", () => {
  it("updates only the chosen sheet and supports lock, position and rotation edits", () => {
    const j = smallJob(),
      s = j.sheets[0],
      p = s.placements[0];
    const next = updateSheetPlacement(j, s.id, p.id, {
      x: 20,
      y: 25,
      rotation: 17,
      locked: true,
    });
    expect(next.sheets[0].placements[0]).toMatchObject({
      x: 20,
      y: 25,
      rotation: 17,
      locked: true,
    });
    expect(j.sheets[0].placements[0].x).not.toBe(20);
    expect(() => jobSchema.parse(next)).not.toThrow();
  });
  it("duplicates a placement and returns removed copies to the unplaced quantity", () => {
    const j = smallJob(),
      s = j.sheets[0],
      p = s.placements[0];
    const copy = duplicateSheetPlacement(j, s.id, p.id);
    expect(copy.job.parts).toHaveLength(1);
    expect(copy.job.sheets[0].placements).toHaveLength(2);
    expect(copy.job.parts[0].quantity).toBe(2);
    const removed = removeSheetPlacement(copy.job, s.id, copy.placementId);
    expect(removed.parts[0].quantity).toBe(2);
    expect(removed.sheets[0].placements).toHaveLength(1);
  });
});
describe("fill a sheet before advancing", () => {
  it("consolidates fifty ring parts from sparse sheets onto the first default sheet", () => {
    const j = newJob("pro"),
      m = {
        ...j.materials[0],
        id: "ring-stock",
        name: "Steel",
        stockKey: "Steel",
        thickness: 3.175,
        kerf: 0.9652,
        lead: 0.93,
      };
    j.materials.push(m);
    const ring = (radius: number, count: number, hole = false) => ({
      closed: true,
      hole,
      points: Array.from({ length: count }, (_, i) => ({
        x: 8 + radius * Math.cos((i / count) * 2 * Math.PI),
        y: 8 + radius * Math.sin((i / count) * 2 * Math.PI),
      })),
    });
    const p = {
      ...makePart("ring", [ring(7.55, 44), ring(3.93, 32, true)]),
      materialId: m.id,
      quantity: 50,
    };
    j.parts = [p];
    for (let n = 0; n < 4; n++)
      j.sheets.push({
        ...j.sheets[0],
        id: `old-${n}`,
        name: `Sheet ${n + 2}`,
        materialId: m.id,
        placements: Array.from({ length: n === 3 ? 2 : 16 }, (_, i) => ({
          id: `old-${n}-${i}`,
          partId: p.id,
          x: 12 + (i % 2) * 24,
          y: 12 + Math.floor(i / 2) * 24,
          rotation: 0,
          scale: 1,
        })),
      });
    j.nesting = {
      rotationStep: 15,
      budgetSeconds: 30,
      budgetMode: "auto",
      maxAutoSeconds: 10,
      effort: "balanced",
      method: "auto",
      objective: "width",
      order: "area",
      insideHoles: true,
      optimize: true,
    };
    const r = nestJobDetailed(j);
    expect(r.placed).toBe(50);
    expect(r.job.sheets[0].placements).toHaveLength(50);
    expect(r.job.sheets.filter((s) => s.placements.length)).toHaveLength(1);
    expect(j.sheets[0].placements).toEqual([]);
  });
  it("finds a fine-angle fit that quarter turns cannot place", () => {
    const p = newProject();
    p.stock = { width: 85, height: 55, margin: 0, spacing: 0 };
    p.material = { ...p.material, kerf: 0, lead: 0 };
    p.parts = [makePart("angled rod", [rectangle(92, 3)])];
    p.nesting = {
      rotationStep: 90,
      budgetSeconds: 1,
      insideHoles: false,
      optimize: false,
    };
    expect(nesting.packSheet(p, true, 100).parts).toHaveLength(0);
    p.nesting.rotationStep = 1;
    const result = nesting.packSheet(p, true, 1000);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].rotation % 90).not.toBe(0);
  });
  it("uses an untouched default sheet for the first requested material", () => {
    const j = newJob("pro"),
      m = {
        ...j.materials[0],
        id: "neoprene",
        name: "Neoprene",
        stockKey: "Neoprene",
        thickness: 3.175,
      };
    j.materials.push(m);
    j.parts = [
      {
        ...makePart("washer", [rectangle(10, 10)]),
        materialId: m.id,
        quantity: 20,
      },
    ];
    const result = nestJobDetailed(j);
    expect(result.placed).toBe(20);
    expect(result.job.sheets).toHaveLength(1);
    expect(result.job.sheets[0].materialId).toBe(m.id);
    expect(j.sheets[0].materialId).not.toBe(m.id);
  });
  it("does not reassign explicitly chosen incompatible sheet stock", () => {
    const j = newJob("pro");
    j.materials[0].name = "Steel";
    j.materials[0].stockKey = "Steel";
    const m = {
      ...j.materials[0],
      id: "neoprene",
      name: "Neoprene",
      stockKey: "Neoprene",
    };
    j.materials.push(m);
    j.parts = [
      {
        ...makePart("washer", [rectangle(10, 10)]),
        materialId: m.id,
        quantity: 4,
      },
    ];
    const result = nestJobDetailed(j);
    expect(result.job.sheets[0].materialId).toBe(j.materials[0].id);
    expect(result.job.sheets[0].placements).toEqual([]);
    expect(result.placed).toBe(4);
  });
  it("continues timed-out partial batches on the same sheet", () => {
    const j = smallJob();
    j.sheets[0].placements = [];
    j.parts[0].quantity = 4;
    const calls: string[] = [];
    const pack = vi
      .spyOn(nesting, "packSheet")
      .mockImplementation((project) => {
        calls.push(
          project.stock.width +
            ":" +
            project.parts.filter((p) => p.locked).length,
        );
        const fixed = project.parts.filter((p) => p.locked),
          free = project.parts.filter((p) => !p.locked),
          p = free[0];
        const parts = p
          ? [
              ...fixed,
              {
                ...p,
                x: 3 + (fixed.length % 2) * 34,
                y: 3 + Math.floor(fixed.length / 2) * 24,
              },
            ]
          : fixed;
        return {
          parts,
          unplaced: free.slice(1),
          provider: "test candidate",
          timedOut: free.length > 1,
        };
      });
    try {
      const result = nestJobDetailed(j);
      expect(result.placed).toBe(4);
      expect(result.job.sheets).toHaveLength(1);
      expect(calls).toHaveLength(4);
    } finally {
      pack.mockRestore();
    }
  });
});

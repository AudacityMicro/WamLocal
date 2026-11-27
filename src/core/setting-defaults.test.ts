import { describe, it, expect } from "vitest";
import {
  saveSettingDefault,
  resolveSettingDefault,
  matchingDefaultMaterial,
  materialTabDefaults,
  applyNewJobDefaults,
  newPartDefaults,
} from "./setting-defaults";
import { defaultMaterial, newJob, type MaterialLibrary } from "./job";
import { setJobMaterial } from "./job-ops";
import {
  defaultMachineSettings,
  withDefaultMachineCosts,
} from "./machine-settings";
import { makePart, rectangle } from "./model";
import { readLibraryFile, writeLibraryFile } from "../desktop/material-library";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
function fixture() {
  const a = {
    ...defaultMaterial("desktop"),
    id: "aluminum",
    name: "Aluminum - 6061",
    stockKey: "Aluminum - 6061",
    thickness: 0.508,
    quality: "fine" as const,
  };
  const b = {
    ...a,
    id: "steel",
    name: "Steel - 1018",
    stockKey: "Steel - 1018",
  };
  return {
    a,
    b,
    library: {
      version: 1 as const,
      materials: [
        a,
        b,
        { ...a, id: "pro", machine: "pro" as const },
        { ...a, id: "medium", quality: "medium" as const },
        { ...a, id: "thicker", thickness: 1 },
      ],
    },
  };
}
describe("scoped setting defaults", () => {
  it("saves into the canonical material record despite copied working IDs without touching other materials, thicknesses, qualities or machines", () => {
    const { a, b, library } = fixture(),
      working = { ...a, id: "job-copy" };
    const updated = saveSettingDefault(library, "tabs.width", 0.7, working);
    expect(updated.settingDefaults).toBeUndefined();
    expect(updated.materials.find((m) => m.id === a.id)!.tabWidth).toBe(0.7);
    expect(matchingDefaultMaterial(updated, working)?.id).toBe(a.id);
    expect(updated.materials.filter((m) => m.id !== a.id)).toEqual(
      library.materials.filter((m) => m.id !== a.id),
    );
    expect(resolveSettingDefault(updated, "tabs.width", 0.254, working)).toBe(
      0.7,
    );
    expect(resolveSettingDefault(updated, "tabs.width", 0.254, b)).toBe(
      b.tabWidth,
    );
    expect(library.materials[0].tabWidth).not.toBe(0.7);
  });
  it("saves process and tab aliases in the material database and reuses defaults when selecting it", () => {
    const { a, library } = fixture();
    let db = saveSettingDefault(library, "lead", 3.4, a);
    db = saveSettingDefault(db, "process.feed", 321, a);
    db = saveSettingDefault(db, "process.tabWidth", 0.8, a);
    db = saveSettingDefault(db, "tabs.minHoleArea", 645.16, a);
    const stored = db.materials.find((m) => m.id === a.id)!;
    expect(stored.lead).toBe(3.4);
    expect(stored.feed).toBe(321);
    expect(resolveSettingDefault(db, "process.tabWidth", 0, a)).toBe(0.8);
    const job = setJobMaterial(newJob(), stored);
    expect(job.tabRules).toMatchObject({
      width: 0.8,
      automaticWidth: false,
      minHoleArea: 645.16,
    });
    expect(job.materials.find((m) => m.id === a.id)!.feed).toBe(321);
  });
  it("represents disabled optional thresholds explicitly and permits restoring the thickness-based policy", () => {
    const { a, library } = fixture();
    let db = saveSettingDefault(library, "tabs.maxPartArea", 100, a);
    db = saveSettingDefault(db, "tabs.maxPartArea", null, a);
    db = saveSettingDefault(db, "tabs.width", 3, a);
    db = saveSettingDefault(db, "tabs.automaticWidth", true, a);
    expect(resolveSettingDefault(db, "tabs.maxPartArea", 200, a)).toBeNull();
    expect(
      materialTabDefaults(db.materials.find((m) => m.id === a.id)!),
    ).toMatchObject({
      width: 1.016,
      automaticWidth: true,
      maxPartArea: undefined,
    });
  });
  it("keeps stock/nesting defaults global and creates jobs using the selected machine's saved material", () => {
    const { a, library } = fixture();
    let db = saveSettingDefault(library, "stock.width", 220);
    db = saveSettingDefault(db, "nesting.rotationStep", 15);
    db = saveSettingDefault(db, "job.materialId.desktop", a.id);
    const job = applyNewJobDefaults(newJob(), db);
    expect(job.sheets[0].stock.width).toBe(220);
    expect(job.nesting!.rotationStep).toBe(15);
    expect(job.sheets[0].materialId).toBe(a.id);
    expect(
      applyNewJobDefaults(newJob("pro"), db).sheets[0].materialId,
    ).not.toBe(a.id);
  });
  it("applies part/contour defaults to new geometry without changing old parts or opening an open path as an outside cut", () => {
    const { a, library } = fixture();
    let db = saveSettingDefault(library, "stockToLeave", 0.2, a);
    db = saveSettingDefault(db, "cut", "inside", a);
    db = saveSettingDefault(db, "contour.tabMode", "none", a);
    const part = makePart("part", [rectangle(10, 10)]),
      material = db.materials.find((m) => m.id === a.id)!;
    expect(newPartDefaults(part, material)).toMatchObject({
      stockToLeave: 0.2,
      cut: "inside",
      contours: [{ tabMode: "none" }],
    });
    expect(part.stockToLeave).toBeUndefined();
    expect(part.cut).toBe("outside");
    const open = {
      ...part,
      cut: "centerline" as const,
      contours: [{ ...part.contours[0], closed: false }],
    };
    expect(newPartDefaults(open, material).cut).toBe("centerline");
  });
  it("retains captured WAZER cost defaults, fills missing legacy costs, and preserves zero and customized prices", () => {
    for (const machine of ["desktop", "pro"] as const) {
      const d = defaultMachineSettings(machine);
      expect(d.abrasiveCostPerKg! * 0.45359237).toBeCloseTo(0.53, 12);
      expect(d.runningCostPerHour).toBe(machine === "pro" ? 6.64 : 5.22);
      expect(
        withDefaultMachineCosts(machine, {
          ...d,
          abrasiveCostPerKg: undefined,
          runningCostPerHour: undefined,
        }).runningCostPerHour,
      ).toBe(d.runningCostPerHour);
      expect(
        withDefaultMachineCosts(machine, {
          ...d,
          runningCostPerHour: 0,
          abrasiveCostPerKg: 2,
        }),
      ).toMatchObject({ runningCostPerHour: 0, abrasiveCostPerKg: 2 });
    }
    const { library } = fixture();
    const saved = saveSettingDefault(
      library,
      "machine.desktop.runningCostPerHour",
      9,
    );
    expect(
      resolveSettingDefault(saved, "machine.desktop.runningCostPerHour", 5.22),
    ).toBe(9);
    expect(
      resolveSettingDefault(saved, "machine.pro.runningCostPerHour", 6.64),
    ).toBe(6.64);
  });
  it("persists material and global defaults through the real library upgrade/export format", async () => {
    const { a, library } = fixture();
    let db: MaterialLibrary = saveSettingDefault(library, "tabs.width", 0.7, a);
    db = saveSettingDefault(db, "stock.width", 250);
    const directory = await mkdtemp(
      path.join(tmpdir(), "wam-scoped-defaults-"),
    );
    try {
      const file = path.join(directory, "library.json");
      await writeLibraryFile(file, db);
      const loaded = await readLibraryFile(file);
      expect(resolveSettingDefault(loaded, "tabs.width", 0, a)).toBe(0.7);
      expect(resolveSettingDefault(loaded, "stock.width", 460)).toBe(250);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20000);
});

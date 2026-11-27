import {defaultTabWidth} from "./tab-defaults";
import { describe, it, expect } from "vitest";
import {
  initialMaterialLibrary,
  extendMaterialLibrary,
  CUT_QUALITIES,
} from "./material-library";
import { materialPresets, presetIssue } from "./material-presets";
import {feedCaptures} from "./material-feed-corrections";
import {estimateMaterialSettings} from "./material-estimate";
import {
  materialName,
  materialQuality,
  thicknessKey,
  qualityProfiles,
  selectMaterialProfile,
} from "./material-selection";
import { defaultMaterial } from "./job";
import { gaugesFor } from "./material-gauges";
import { readLibraryFile, writeLibraryFile } from "../desktop/material-library";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("complete material quality catalog", () => {
  it("fills absent legacy abrasive rates from the machine and preserves explicit values",()=>{
    const library=initialMaterialLibrary();
    library.machines!.desktop.abrasive=175;
    const records=library.materials.filter(m=>m.machine==="desktop").slice(0,3);
    records[0].abrasive=undefined;records[1].abrasive=0;records[2].abrasive=321;
    const upgraded=extendMaterialLibrary(library);
    expect(records.map(m=>upgraded.materials.find(p=>p.id===m.id)!.abrasive)).toEqual([175,0,321]);
  });
  it("has captured Pro settings for every 7-26 gauge of each standard metal stock", () => {
    const library = initialMaterialLibrary();
    for (const stock of new Set(materialPresets.map((p) => p.name)))
      for (const gauge of gaugesFor(stock))
        for (const quality of CUT_QUALITIES) {
          const m = library.materials.find(
            (m) =>
              m.machine === "pro" &&
              materialName(m) === stock &&
              Math.abs(m.thickness - gauge.mm) < 1e-7 &&
              materialQuality(m) === quality,
          );
          expect(m, `${stock} ${gauge.gauge} Ga ${quality}`).toBeDefined();
          expect(m!.requiresVerification).toBe(false);
          expect(m!.preset).toBeDefined();
        }
  });
  it("lets an old saved placeholder select the recorded replacement without mixing machines", () => {
    const records = initialMaterialLibrary().materials;
    const recorded = records.find((m) => m.id === "pro-0-0.02-medium")!;
    const old = {
      ...recorded,
      id: "old-gauge",
      name: "Aluminum - 6061",
      feed: 100,
      requiresVerification: true,
      preset: undefined,
      source: "Nominal sheet gauge thickness",
    };
    const offered = qualityProfiles(records, old, "pro");
    expect(offered.some((m) => m.id === old.id)).toBe(true);
    expect(offered.some((m) => m.id === recorded.id)).toBe(true);
    expect(offered.every((m) => m.machine === "pro")).toBe(true);
    expect(
      selectMaterialProfile(
        [old, ...records],
        old,
        "pro",
        "Aluminum - 6061",
        0.508,
      ).id,
    ).toBe(recorded.id);
    expect(old.feed).toBe(100);
    const desktop = { ...old, machine: "desktop" as const };
    expect(
      qualityProfiles(records, desktop, "desktop").every(
        (m) => m.machine === "desktop",
      ),
    ).toBe(true);
    expect(
      selectMaterialProfile(
        records,
        desktop,
        "desktop",
        "Aluminum - 6061",
        0.508,
      ).machine,
    ).toBe("desktop");
  });
  it("includes exact WAM 0.020 inch aluminum feeds for all three qualities", () => {
    const library = initialMaterialLibrary();
    for (const [quality, feed] of [
      ["coarse", 605],
      ["medium", 537.78],
      ["fine", 470.55],
    ] as const) {
      const m = library.materials.find(
        (m) => m.id === `pro-0-0.02-${quality}`,
      )!;
      expect(m.thickness).toBeCloseTo(0.508, 8);
      expect(m.feed).toBeCloseTo(feed, 8);
      expect(m.pierce).toBe(1.21);
      expect(m.requiresVerification).toBe(false);
      expect(m.preset).toEqual({ id: "pro-0-0.02", quality });
    }
  });
  it("loads every captured thickness and preserves each quality's actual feed", () => {
    const library = initialMaterialLibrary();
    for (const p of materialPresets)
      for (const quality of CUT_QUALITIES) {
        const m = library.materials.find((m) => m.id === `${p.id}-${quality}`)!;
        expect(m.feed).toBe(p.feeds[quality]);
        expect(m.pierce).toBe(p.pierce);
        expect(m.abrasive).toBe(p.abrasive);
        expect(m.requiresVerification).toBe(!!presetIssue(p)||!!p.processProxy||!!p.requiresProcessReview);
        expect(m.tabWidth).toBeLessThanOrEqual(20);
        if (presetIssue(p)||p.processProxy||p.requiresProcessReview) expect(m.preset).toBeUndefined();
        else expect(m.tabWidth).toBe(defaultTabWidth(p.thicknessMm));
      }
  });
  it("offers every quality for each listed machine/material/thickness without reusing Pro feeds on Desktop", () => {
    const library = initialMaterialLibrary();
    const groups = new Map<string, Set<string>>();
    for (const m of library.materials) {
      const key = `${m.machine}|${materialName(m)}|${thicknessKey(m.thickness)}`;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key)!.add(materialQuality(m));
      if (m.machine === "desktop" && m.quality && m.quality !== "custom") {
        expect(m.requiresVerification).toBe(true);
        expect(m.preset).toBeUndefined();
        if (m.source?.includes("WAM Desktop demo feed capture")) {
          const capture=feedCaptures.find(c=>c.name===m.stockKey&&Math.abs(c.thicknessMm-m.thickness)<1e-7)!;
          expect(capture).toBeDefined();
          expect(m.feed).toBe(capture.feeds[m.quality as "coarse"|"medium"|"fine"]);
        } else if(materialName(m)!=="Custom material") expect(m.feed).toBe(estimateMaterialSettings(m,m.thickness,m.quality).feed);
        else expect(m.feed).toBe(defaultMaterial("desktop").feed);
      }
    }
    for (const qualities of groups.values())
      for (const quality of CUT_QUALITIES)
        expect(qualities.has(quality)).toBe(true);
  });
  it("preserves edited defaults and upgrades old libraries without duplicate IDs", () => {
    const edited = {
      ...initialMaterialLibrary().materials.find(
        (m) => m.id === "pro-0-0.125-fine",
      )!,
      feed: 123.45,
      source: "User-edited defaults",
    };
    const old = { version: 1 as const, materials: [edited] };
    const upgraded = extendMaterialLibrary(old);
    const again = extendMaterialLibrary(upgraded);
    expect(old.materials).toEqual([edited]);
    expect(again.materials.find((m) => m.id === edited.id)).toEqual(edited);
    expect(again.materials).toHaveLength(upgraded.materials.length);
    expect(new Set(again.materials.map((m) => m.id)).size).toBe(
      again.materials.length,
    );
  });
  it("upgrades a persisted library and round-trips the full catalog", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "wam-catalog-"));
    try {
      const file = path.join(folder, "presets.json");
      await writeLibraryFile(file, {
        version: 1,
        materials: [defaultMaterial("pro")],
      });
      const upgraded = await readLibraryFile(file);
      expect(upgraded.materials.some((m) => m.id === "pro-0-0.02-medium")).toBe(
        true,
      );
      await writeLibraryFile(file, upgraded);
      const read = await readLibraryFile(file);
      expect(read.materials).toHaveLength(upgraded.materials.length);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

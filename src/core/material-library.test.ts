import { describe, it, expect } from "vitest";
import {
  initialMaterialLibrary,
  extendMaterialLibrary,
  CUT_QUALITIES,
} from "./material-library";
import { materialPresets, presetIssue } from "./material-presets";
import {
  materialName,
  materialQuality,
  thicknessKey,
} from "./material-selection";
import { defaultMaterial } from "./job";
import { readLibraryFile, writeLibraryFile } from "../desktop/material-library";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("complete material quality catalog", () => {
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
        expect(m.requiresVerification).toBe(!!presetIssue(p));
        expect(m.tabWidth).toBeLessThanOrEqual(20);
        if (presetIssue(p)) expect(m.preset).toBeUndefined();
        else expect(m.tabWidth).toBe(p.tabWidth);
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
        expect(m.feed).toBe(defaultMaterial("desktop").feed);
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

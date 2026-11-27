import { describe, it, expect } from "vitest";
import {
  initialMaterialLibrary,
  extendMaterialLibrary,
} from "./material-library";
import { repairMaterialProfiles } from "./material-profile-repairs";
import { materialName } from "./material-selection";
import { estimateMaterialSettings } from "./material-estimate";
import {
  materialFeedCorrections,
  feedCaptures,
} from "./material-feed-corrections";

describe("reviewed material repairs", () => {
  const library = initialMaterialLibrary();
  it("replaces named generic feeds with bounded same-machine estimates", () => {
    expect(
      library.materials.filter(
        (m) =>
          m.feed === 100 &&
          m.source?.startsWith("No exact WAM") &&
          materialName(m) !== "Custom material",
      ),
    ).toEqual([]);
  });
  it("uses same-thickness acrylic processes for Pro EPDM, flags endpoint clamps", () => {
    const epdm = library.materials.find(
      (m) =>
        m.machine === "pro" &&
        materialName(m) === "EPDM - EPDM" &&
        m.quality === "medium",
    )!;
    for (const thickness of [1, 3, 10, 100]) {
      const p = estimateMaterialSettings(epdm, thickness, "medium");
      expect(p.requiresVerification).toBe(true);
      expect(p.preset).toBeUndefined();
      expect(p.feed).not.toBe(10.16);
      expect(p.thickness).toBe(thickness);
      if (thickness === 100) expect(p.source).toContain("nearest endpoint");
      else {
        const acrylic = estimateMaterialSettings(
          { ...epdm, name: "Acrylic - Acrylic", stockKey: "Acrylic - Acrylic" },
          thickness,
          "medium",
        );
        expect([p.feed, p.pierce, p.lead, p.abrasive]).toEqual([
          acrylic.feed,
          acrylic.pierce,
          acrylic.lead,
          acrylic.abrasive,
        ]);
      }
    }
  });
  it("migrates known stale captures, preserves user edits, and is idempotent", () => {
    for (const correction of materialFeedCorrections) {
      const base = library.materials.find(
        (m) =>
          m.machine === correction.machine &&
          materialName(m) === correction.name &&
          Math.abs(m.thickness - correction.thicknessMm) < 1e-7 &&
          m.quality === correction.quality,
      )!;
      expect(base.feed).toBe(correction.feed);
      const stale = {
        ...base,
        feed: correction.previousFeed,
        processRevision: undefined,
        source: "WAM Desktop demo feed capture",
      };
      const [fixed] = repairMaterialProfiles([stale]);
      expect(fixed.feed).toBe(correction.feed);
      expect(repairMaterialProfiles([fixed])).toEqual([fixed]);
      expect(
        repairMaterialProfiles([
          { ...stale, source: "User-edited process values" },
        ])[0].feed,
      ).toBe(correction.previousFeed);
      expect(repairMaterialProfiles([{ ...stale, feed: 17 }])[0].feed).toBe(17);
      expect(
        feedCaptures.find(
          (c) =>
            c.machine === correction.machine &&
            c.name === correction.name &&
            Math.abs(c.thicknessMm - correction.thicknessMm) < 1e-7,
        )!.feeds[correction.quality as "coarse"],
      ).toBe(correction.feed);
    }
    expect(extendMaterialLibrary(library)).toEqual(library);
  });
  it("keeps unvalidated constant foam settings marked for review", () => {
    const foam = library.materials.filter(
      (m) =>
        m.machine === "pro" && materialName(m) === "Polyethylene Foam - 4lb",
    );
    expect(foam.length).toBeGreaterThan(0);
    expect(foam.every((m) => m.requiresVerification && !m.preset)).toBe(true);
    const p = estimateMaterialSettings(foam[0], 3.175, "medium");
    expect(p.requiresVerification).toBe(true);
    expect(p.preset).toBeUndefined();
  });
});

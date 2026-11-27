import { describe, it, expect } from "vitest";
import {
  estimateMaterialSettings,
  monotoneInterpolate,
} from "./material-estimate";
import { defaultMaterial } from "./job";
import { materialPresets, applyMaterialPreset } from "./material-presets";
import { newProject } from "./model";

const base = {
  ...defaultMaterial("pro"),
  stockKey: "Aluminum - 6061",
  name: "Aluminum - 6061",
};
describe("same-machine custom thickness estimates", () => {
  it("keeps a cubic inside each bracket and preserves plateaus and linear data", () => {
    for (let n = 1; n < 300; n++) {
      const x = n / 100,
        i = Math.min(2, Math.floor(x));
      const ys = [2, 2, 5, 6],
        value = monotoneInterpolate([0, 1, 2, 3], ys, x);
      expect(value).toBeGreaterThanOrEqual(ys[i]);
      expect(value).toBeLessThanOrEqual(ys[i + 1]);
      expect(monotoneInterpolate([0, 1, 2, 3], [1, 3, 5, 7], x)).toBeCloseTo(
        1 + 2 * x,
        8,
      );
    }
  });
  it("replaces placeholder settings with the exact .020-inch Pro reference", () => {
    const result = estimateMaterialSettings(
      { ...base, requiresVerification: true },
      0.508,
      "medium",
    );
    expect(result.requiresVerification).toBe(false);
    expect(result.feed).toBeCloseTo(537.78,8);
    expect(result.pierce).toBe(1.21);
  });
  it("clears a stale verification flag only when an exact preset is explicitly applied", () => {
    const preset = materialPresets.find(
      (p) => p.name === base.name && p.thicknessMm === 0.508,
    )!;
    const project = newProject();
    project.machine = "pro";
    project.material.requiresVerification = true;
    expect(
      applyMaterialPreset(project, preset.id, "fine").material
        .requiresVerification,
    ).toBe(false);
  });
  it("does not reuse Pro records for the user's Desktop .020-inch job", () => {
    const result=estimateMaterialSettings({ ...base, machine: "desktop" },0.508,"medium");
    expect(result.feed).toBe(186.59);
    expect(result.pierce).not.toBe(1.21);
    expect(result.requiresVerification).toBe(true);
  });
  it("generates bounded starting estimates, keeps edits unrelated to process values, and requires review", () => {
    const result = estimateMaterialSettings(
      { ...base, kerf: 1.234, tabCount: 3 },
      0.53,
      "fine",
    );
    expect(result.requiresVerification).toBe(true);
    expect(result.preset).toBeUndefined();
    expect(result.source).toContain("Estimated");
    expect(result.feed).toBeGreaterThan(438.28);
    expect(result.feed).toBeLessThan(470.56);
    expect(result.kerf).toBe(1.234);
    expect(result.tabCount).toBe(3);
  });
  it.each([0, -1, NaN, Infinity, 25.4, 0.00001, 0.1])(
    "rejects invalid, extrapolated or sparse thickness %s",
    (thickness) => {
      expect(() =>
        estimateMaterialSettings(base, thickness, "medium"),
      ).toThrow();
    },
  );
});

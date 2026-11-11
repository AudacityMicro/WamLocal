import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  lookupRecordedMaterial,
  materialParameter,
  materialParameterPaths,
  type MaterialCapture,
} from "./material-reference";
const captures = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/wam-reference/materials/samples.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as MaterialCapture[];
describe("captured Pro material settings", () => {
  it("covers all 24 materials, with a reference at each displayed maximum", () => {
    const limits = JSON.parse(
      readFileSync(
        new URL(
          "../../fixtures/wam-reference/material-limits.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ).materials;
    expect(new Set(captures.map((c) => c.name)).size).toBe(24);
    for (const limit of limits)
      expect(
        captures.some(
          (c) =>
            c.name === limit.name &&
            Math.abs(c.thicknessIn - limit.max) < 1e-10,
        ),
      ).toBe(true);
  });
  for (const name of [...new Set(captures.map((c) => c.name))])
    it(`${name}: reproduces every recorded field at its captured thicknesses`, () => {
      for (const c of captures.filter((c) => c.name === name)) {
        const actual = lookupRecordedMaterial(
          captures,
          "pro",
          name,
          c.thicknessIn,
        );
        for (const path of materialParameterPaths) {
          expect(Number.isFinite(materialParameter(actual, path))).toBe(true);
          expect(materialParameter(actual, path)).toBe(
            materialParameter(c.data, path),
          );
        }
      }
    });
  it("does not invent settings at uncaptured thicknesses or for Desktop", () => {
    expect(() =>
      lookupRecordedMaterial(captures, "pro", "Aluminum - 6061", 0.111111),
    ).toThrow(/No exact WAM capture/);
    expect(() =>
      lookupRecordedMaterial(captures, "desktop", "Aluminum - 6061", 0.1),
    ).toThrow(/No exact WAM capture/);
    expect(() =>
      lookupRecordedMaterial(captures, "pro", "Aluminum - 6061", 0),
    ).toThrow(/positive/);
  });
  it("returns independent data, preserving the original reference", () => {
    const c = captures[0],
      v = lookupRecordedMaterial(captures, "pro", c.name, c.thicknessIn);
    v.speedMode.roughRate.value = -1;
    expect(c.data.speedMode.roughRate.value).toBeGreaterThan(0);
  });
});

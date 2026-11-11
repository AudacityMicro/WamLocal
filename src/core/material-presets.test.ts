import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { newProject, projectSchema } from "./model";
import {
  activeMaterialPreset,
  applyMaterialPreset,
  materialPresets,
  presetIssue,
  type CutQuality,
} from "./material-presets";
import type { MaterialCapture } from "./material-reference";

const captures: MaterialCapture[] = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/wam-reference/materials/samples.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
describe("material preset integration", () => {
  it("matches all original captures and qualities without including Eco placeholder rates", () => {
    expect(materialPresets.length).toBe(captures.length);
    expect(new Set(materialPresets.map((p) => p.name)).size).toBe(24);
    expect(new Set(materialPresets.map((p) => p.id)).size).toBe(
      captures.length,
    );
    for (const capture of captures) {
      const id = `pro-${capture.materialIndex}-${capture.thicknessIn}`;
      const preset = materialPresets.find((p) => p.id === id)!;
      expect(preset).toBeDefined();
      for (const [quality, rate] of [
        ["coarse", "roughRate"],
        ["medium", "mediumRate"],
        ["fine", "fineRate"],
      ] as const) {
        expect(preset.feeds[quality]).toBe(capture.data.speedMode[rate].value);
        if (presetIssue(preset)) {
          expect(() =>
            applyMaterialPreset(
              { ...newProject(), machine: "pro" },
              id,
              quality,
            ),
          ).toThrow(/editor limit/);
          continue;
        }
        const applied = applyMaterialPreset(
          { ...newProject(), machine: "pro" },
          id,
          quality,
        );
        expect(applied.material).toMatchObject({
          name: capture.name,
          thickness: capture.thicknessIn * 25.4,
          feed: capture.data.speedMode[rate].value,
          pierce: capture.data.pierceTime.value,
          abrasive: capture.data.speedMode.abrasiveRate.value,
          lead: capture.data.defaultLeadDist.value,
          tabWidth: capture.data.defaultTabWidth.value,
        });
        expect(
          activeMaterialPreset(
            projectSchema.parse(JSON.parse(JSON.stringify(applied))),
          )?.id,
        ).toBe(id);
      }
    }
  });
  it("preserves the job, kerf and tab count without mutating input", () => {
    const project = { ...newProject(), machine: "pro" as const };
    project.material.kerf = 0.9652;
    project.material.tabCount = 7;
    const original = structuredClone(project);
    const applied = applyMaterialPreset(project, "pro-0-0.125", "fine");
    expect(project).toEqual(original);
    expect(applied.material.kerf).toBe(0.9652);
    expect(applied.material.tabCount).toBe(7);
    expect(applied.stock).toEqual(project.stock);
    expect(applied.parts).toEqual(project.parts);
  });
  it("rejects Desktop, unknown records, unknown qualities and tab outliers", () => {
    expect(() =>
      applyMaterialPreset(newProject(), "pro-0-0.125", "medium"),
    ).toThrow(/requires WAZER Pro/);
    const pro = { ...newProject(), machine: "pro" as const };
    expect(() => applyMaterialPreset(pro, "pro-0-0.126", "medium")).toThrow(
      /Unknown material preset/,
    );
    expect(() =>
      applyMaterialPreset(pro, "pro-0-0.125", "eco" as CutQuality),
    ).toThrow(/Unknown cut quality/);
    expect(() => applyMaterialPreset(pro, "pro-18-0.001", "medium")).toThrow(
      /tab width/,
    );
  });
  it("does not label changed values or a changed machine as a matching reference", () => {
    const applied = applyMaterialPreset(
      { ...newProject(), machine: "pro" },
      "pro-0-0.125",
      "medium",
    );
    expect(activeMaterialPreset(applied)).toBeDefined();
    expect(
      activeMaterialPreset({ ...applied, machine: "desktop" }),
    ).toBeUndefined();
    for (const key of [
      "thickness",
      "feed",
      "pierce",
      "abrasive",
      "tabWidth",
      "lead",
    ] as const) {
      const edited = structuredClone(applied);
      edited.material[key] = edited.material[key]! + 1;
      expect(activeMaterialPreset(edited)).toBeUndefined();
    }
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import init from "occt-import-js";
import { readFile } from "node:fs/promises";
import {
  extractStepFaces,
  selectStepFace,
  stepPart,
  type StepResult,
} from "./step-import";
import { partSchema } from "./model";

let kernel: Awaited<ReturnType<typeof init>>;
beforeAll(async () => {
  kernel = await init({ print: () => {}, printErr: () => {} });
});
async function load(name: string, tolerance = 0.01) {
  return kernel.ReadStepFile(
    await readFile(
      new URL(`../../fixtures/step/${name}.step`, import.meta.url),
    ),
    {
      linearUnit: "millimeter",
      linearDeflectionType: "absolute_value",
      linearDeflection: tolerance,
      angularDeflection: 0.1,
    },
  );
}
describe("STEP cutting face extraction with the real OpenCascade reader", () => {
  it("converts STEP inch units into millimetres without applying the DXF unit preference", async () => {
    const p = stepPart("inch.step", await load("inch-plate"));
    const f = p.stepSource!.faces.find((f) => f.id === p.stepSource!.selected)!;
    expect(f.area).toBeCloseTo(25.4 * 12.7, 5);
    const pts = p.contours.flatMap((c) => c.points);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(25.4, 5);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(12.7, 5);
  });
  it("retains faces from multiple bodies and allows explicitly choosing another body", async () => {
    const result = await load("two-bodies"),
      p = stepPart("assembly.step", result);
    expect(p.stepSource!.bodyCount).toBe(2);
    expect(
      p.stepSource!.faces.find((f) => f.id === p.stepSource!.selected)!.area,
    ).toBeCloseTo(4000);
    const other = p.stepSource!.faces.find((f) => f.id.startsWith("1:"))!;
    expect(
      stepPart("assembly.step", result, 0.01, other.id).stepSource!.selected,
    ).toBe(other.id);
  });
  it("selects the broad face and extracts just its outline and two through-holes", async () => {
    const p = stepPart("plate.step", await load("drilled-plate"));
    expect(p.contours).toHaveLength(3);
    expect(p.contours.filter((c) => c.hole)).toHaveLength(2);
    const all = p.contours.flatMap((c) => c.points);
    expect(Math.max(...all.map((p) => p.x))).toBeCloseTo(100, 5);
    expect(Math.max(...all.map((p) => p.y))).toBeCloseTo(60, 5);
    expect(
      p.stepSource!.faces.find((f) => f.id === p.stepSource!.selected)
        ?.blindHoles,
    ).toBe(0);
  });
  it("projects an arbitrarily rotated plate into its planar coordinate system", async () => {
    const p = stepPart("rotated.step", await load("rotated-plate"));
    expect(p.contours.filter((c) => c.hole)).toHaveLength(2);
    const f = p.stepSource!.faces.find((f) => f.id === p.stepSource!.selected)!;
    expect(f.area).toBeCloseTo(6000, 5);
  });
  it("does not prefer a blind pocket over the unobstructed broad back face", async () => {
    const p = stepPart("blind.step", await load("blind-pocket"));
    const selected = p.stepSource!.faces.find(
      (f) => f.id === p.stepSource!.selected,
    )!;
    expect(selected.area).toBeCloseTo(6000, 5);
    expect(selected.holes).toBe(0);
    expect(p.stepSource!.faces.some((f) => f.blindHoles === 1)).toBe(true);
  });
  it("retains alternatives through serialization and replaces contour overrides when changing faces", async () => {
    const p = partSchema.parse(
      JSON.parse(
        JSON.stringify(stepPart("plate.step", await load("drilled-plate"))),
      ),
    );
    const side = p.stepSource!.faces.find((f) => f.area < 1000)!;
    p.contours[0].tabs = [{ width: 1, position: 0.2 }];
    const next = selectStepFace(p, side.id);
    expect(next.id).toBe(p.id);
    expect(next.contours).toHaveLength(1);
    expect(next.contours[0].tabs).toBeUndefined();
    expect(next.stepSource!.selected).toBe(side.id);
    expect(p.contours).toHaveLength(3);
    expect(() => selectStepFace(p, "missing")).toThrow("unavailable");
  });
  it("rejects curved-only, empty, invalid and nonexistent face choices", async () => {
    expect(() => extractStepFaces({ success: false })).toThrow(
      "could not be read",
    );
    expect(() => extractStepFaces({ success: true, meshes: [] })).toThrow(
      "no solid",
    );
    expect(() => stepPart("sphere", sphere)).toThrow("No closed planar");
    const result = await load("drilled-plate");
    expect(() => stepPart("plate", result, 0.01, "missing")).toThrow(
      "not planar",
    );
    expect(() => extractStepFaces(result, 0)).toThrow();
  });
  let sphere: StepResult;
  beforeAll(async () => {
    sphere = await load("sphere");
  });
  it("uses the configured curve tolerance for circular boundaries", async () => {
    const fine = stepPart("fine", await load("drilled-plate", 0.001), 0.001);
    const coarse = stepPart("coarse", await load("drilled-plate", 0.1), 0.1);
    expect(
      fine.contours.filter((c) => c.hole).flatMap((c) => c.points).length,
    ).toBeGreaterThan(
      coarse.contours.filter((c) => c.hole).flatMap((c) => c.points).length,
    );
  });
});

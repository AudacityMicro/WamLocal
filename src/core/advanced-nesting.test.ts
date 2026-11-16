import { describe, it, expect } from "vitest";
import { newProject, makePart, rectangle } from "./model";
import { nest, plan } from "./geometry";
import { rotationAngles } from "./advanced-nesting";
import {
  gaugesFor,
  materialForMachine,
  extendGaugeLibrary,
} from "./material-gauges";
import { initialMaterialLibrary } from "./material-library";
import { readJob } from "./job";
import { nestJob } from "./job-ops";
const project = () => ({
  ...newProject(),
  stock: { width: 100, height: 100, margin: 2, spacing: 2 },
  material: { ...newProject().material, lead: 0, kerf: 0, pierceDiameter: 0 },
  nesting: {
    rotationStep: 45 as const,
    budgetSeconds: 2,
    insideHoles: false,
    optimize: false,
  },
});
describe("nesting constraints", () => {
  it("preserves locked copies while filling the remaining job quantities", () => {
    const p = project();
    p.parts = [
      makePart("fixed", [rectangle(20, 20)], 5, 5),
      makePart("free", [rectangle(15, 15)], 50, 50),
    ];
    const job = readJob(p);
    job.nesting = p.nesting;
    job.sheets[0].placements[0].locked = true;
    job.parts[1].quantity = 2;
    const fixed = { ...job.sheets[0].placements[0] };
    const out = nestJob(job);
    expect(out.sheets[0].placements.find((p) => p.id === fixed.id)).toEqual(
      fixed,
    );
    expect(
      out.sheets
        .flatMap((s) => s.placements)
        .filter((p) => p.partId === job.parts[1].id),
    ).toHaveLength(2);
  });
  it("finds a 45 degree placement when quarter-turns cannot fit", () => {
    const p = project();
    p.stock.width = 75;
    p.stock.height = 75;
    p.parts = [makePart("diagonal", [rectangle(90, 10)])];
    expect(nest(p).parts[0].rotation % 90).toBe(45);
  });
  it("keeps locked placements fixed and finds free stock around them", () => {
    const p = project();
    p.parts = [
      { ...makePart("locked", [rectangle(30, 30)], 5, 5), locked: true },
      makePart("free", [rectangle(25, 25)]),
    ];
    const out = nest(p);
    expect(out.parts[0]).toEqual(p.parts[0]);
    expect(out.parts).toHaveLength(2);
  });
  it("supports rotation steps and independent grain/do-not-rotate rules", () => {
    const p = makePart("part", [rectangle()]);
    expect(rotationAngles(p, 15, true)).toHaveLength(24);
    expect(
      rotationAngles({ ...p, rotationPolicy: "grain-x" }, 15, true),
    ).toEqual([0, 180]);
    expect(
      rotationAngles({ ...p, rotationPolicy: "grain-y" }, 45, true),
    ).toEqual([90, 270]);
    expect(
      rotationAngles({ ...p, rotation: 17, rotationPolicy: "fixed" }, 15, true),
    ).toEqual([17]);
  });
  it("rejects invalid locked layouts", () => {
    const p = project();
    p.parts = [
      { ...makePart("bad", [rectangle(30, 30)], 90, 90), locked: true },
    ];
    expect(() => nest(p)).toThrow(/Locked/);
  });
  it("fits a part inside a locked plate hole with spacing and cuts that part first", () => {
    const p = project();
    p.nesting.insideHoles = true;
    const hole = {
      ...rectangle(50, 50),
      hole: true,
      points: rectangle(50, 50).points.map((v) => ({
        x: v.x + 15,
        y: v.y + 15,
      })),
    };
    p.parts = [
      { ...makePart("host", [rectangle(80, 80), hole], 5, 5), locked: true },
      makePart("nested", [rectangle(30, 30)]),
    ];
    const out = nest(p);
    expect(out.parts[1].x).toBeGreaterThan(20);
    expect(out.parts[1].y).toBeGreaterThan(20);
    const moves = plan(out).moves;
    expect(moves.findIndex((m) => m.partId === out.parts[1].id)).toBeLessThan(
      moves.findIndex((m) => m.partId === out.parts[0].id),
    );
  });
});
describe("gauge presets", () => {
  it("uses material-specific US thicknesses", () => {
    expect(gaugesFor("Steel - 1018").find((g) => g.gauge === 16)?.inches).toBe(
      0.0598,
    );
    expect(
      gaugesFor("Stainless Steel - 304").find((g) => g.gauge === 16)?.inches,
    ).toBe(0.0625);
    expect(
      gaugesFor("Aluminum - 6061").find((g) => g.gauge === 12)?.inches,
    ).toBe(0.08);
  });
  it("preserves customized presets on upgrades and does not copy Pro feeds to Desktop", () => {
    const db = initialMaterialLibrary();
    db.materials[0].feed = 123;
    const next = extendGaugeLibrary(db);
    expect(next.materials).toHaveLength(db.materials.length);
    expect(next.materials[0].feed).toBe(123);
    const source = next.materials.find((m) => m.machine === "pro" && m.preset)!;
    const copy = materialForMachine(source, "desktop");
    expect(copy.machine).toBe("desktop");
    expect(copy.preset).toBeUndefined();
    expect(copy.requiresVerification).toBe(true);
  });
});

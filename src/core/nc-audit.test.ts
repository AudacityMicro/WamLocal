import { describe, it, expect } from "vitest";
import { auditNc } from "./nc-audit";
import { comparePostedReference, freshCases } from "../../scripts/compare-wam-posting";
import { cases } from "../../scripts/analyze-wam-reference";

const valid = "G90\nG21\nM1403\nG0 X20 Y-20\nM3\nM8\nG4 S1.21\nG1 X30 Y-20 F100\nM9\nM5\nM1404\n";
describe("independent NC state audit", () => {
  it("accepts balanced cutting and measures the pierce and feed", () => {
    const audit = auditNc(valid);
    expect(audit.errors).toEqual([]);
    expect(audit.pierceDwells).toEqual([1.21]);
    expect(audit.feedLevels).toEqual([100]);
    expect(audit.cutLength).toBe(10);
  });
  it.each([
    [valid.replace("G1 X30", "G0 X30"), "rapid motion with jet"],
    [valid.replace("M8\n", ""), "linear cut without water"],
    [valid.replace("M9\nM5", "M5\nM9"), "water shut off before abrasive"],
    [valid.replace("M1403\n", ""), "motion before initialization"],
    [valid.replace("M1404\n", ""), "Missing WAZER shutdown"],
    [valid + "G0 X0 Y0\n", "command after shutdown"],
  ])("rejects invalid process sequencing", (source, message) => {
    expect(auditNc(source).errors.some(e => e.includes(message))).toBe(true);
  });
});

describe("actual posted output against browser-captured WAM references", () => {
  it.each(cases)("checks the saved baseline %s", async name => {
    const r = await comparePostedReference(name);
    expect(r.wam.errors).toEqual([]); expect(r.local.errors).toEqual([]);
    expect(r.local.feedMaximum).toBeCloseTo(r.wam.feedMaximum, 3);
    expect(r.local.pierceDwells).toEqual(r.wam.pierceDwells);
    if (["sq-centerline", "open-centerline"].includes(name)) {
      expect(r.local.bounds).toEqual(r.wam.bounds);
      expect(r.local.cutLength).toBe(r.wam.cutLength);
    }
  });
  it.each(freshCases)("audits %s and checks nominal process values", async name => {
    const r = await comparePostedReference(name);
    expect(r.wam.errors).toEqual([]); expect(r.local.errors).toEqual([]);
    expect(r.local.feedMaximum).toBeCloseTo(r.wam.feedMaximum, 3);
    expect(r.local.pierceDwells.every(v => Math.abs(v - 1.21) < 0.0001)).toBe(true);
    expect(r.wam.pierceDwells.every(v => Math.abs(v - 1.21) < 0.0001)).toBe(true);
    if (["cmp020c", "cmp020m", "cmp020f"].includes(name)) {
      expect(r.local.bounds).toEqual(r.wam.bounds);
      expect(Math.abs(r.local.cutLength - r.wam.cutLength)).toBeLessThan(0.1);
    }
    // These are diagnostic comparisons, not an assertion of path equivalence.
    expect(r.local.feedLevels.length).toBeGreaterThan(1);
    expect(r.wam.feedLevels.length).toBeGreaterThan(1);
  });
});

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { cases, compareCase, root } from "../../scripts/analyze-wam-reference";
import { inspectReferenceNc } from "./nc-inspect";
import { distance } from "./geometry";
describe("captured WAM 2.5.0 Pro references", () => {
  for (const name of cases)
    it(`${name}: contains complete nonempty metric absolute motion`, async () => {
      const { nc, local } = await compareCase(name);
      expect(nc.cutLength).toBeGreaterThan(0);
      expect(nc.unsupportedCodes).toEqual([]);
      expect(nc.mCodes[0]).toBe("M1403");
      expect(nc.mCodes.at(-1)).toBe("M1404");
      expect(local.issues).toEqual([]);
    });
  for (const [name, length] of [
    ["sq-centerline", 200],
    ["open-centerline", 70],
  ] as const)
    it(`${name}: matches source dimensions, position and cut length`, async () => {
      const { nc, local } = await compareCase(name);
      expect(nc.cutLength).toBeCloseTo(length, 3);
      expect(local.cutLength).toBeCloseTo(length, 3);
      expect(nc.bounds!.x).toBeCloseTo(20, 2);
      expect(nc.bounds!.y).toBeCloseTo(20, 2);
      expect(nc.bounds!.width).toBeCloseTo(50, 2);
      const endpoints = local.moves
        .filter((m) => m.kind === "cut")
        .flatMap((m) => [m.from, m.to]);
      expect(Math.min(...endpoints.map((p) => p.x))).toBeCloseTo(20, 2);
      expect(Math.min(...endpoints.map((p) => p.y))).toBeCloseTo(20, 2);
    });
  it("outside compensation matches extent within output rounding", async () => {
    const { summary } = await compareCase("sq-outside");
    expect(
      Math.abs(summary.localBounds!.width - summary.wamBounds!.width),
    ).toBeLessThan(0.01);
    expect(
      Math.abs(summary.localBounds!.x - summary.wamBounds!.x),
    ).toBeLessThan(0.01);
  });
  it("plate cuts the internal hole before the external profile", async () => {
    const { nc } = await compareCase("plate-hole-valid");
    expect(nc.segments).toBe(2);
    const first = nc.moves.filter((m) => !m.rapid && m.segment === 0);
    expect(first.length).toBeGreaterThan(50);
    expect(
      Math.max(
        ...first.flatMap((m) => [
          distance(m.from, { x: 50, y: 40 }),
          distance(m.to, { x: 50, y: 40 }),
        ]),
      ),
    ).toBeLessThan(10.1);
  });
  it("detects the empty export caused by uninitialized material", async () => {
    const nc = inspectReferenceNc(
      await readFile(
        new URL("diagnostics/plate-uninitialized-material.gcode", root),
        "utf8",
      ),
    );
    expect(nc.cutLength).toBe(0);
    expect(nc.segments).toBe(0);
    expect(nc.bounds).toBeNull();
  });
});

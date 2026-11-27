import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSimulation, simulationAt } from "./gcode-simulation";
import { readJob } from "./job";
import { postJob } from "./postprocessor";
import { inspectReferenceNc } from "./nc-inspect";
const code =
  "G90\nG21\nG0 X10 Y-5\nM3\nM8\nG4 S2.5\nG1 X20 Y-5 F60\nG4 S1\nM9\nG4 S1\nM5\nG4 S1\nM1404\n";
describe("posted G-code simulation", () => {
  it("times physical motion at emitted feeds, including rapid/pierce/shutdown waits", () => {
    const sim = parseSimulation(code, 600);
    expect(sim.events.map((e) => e.kind)).toEqual([
      "rapid",
      "pierce",
      "cut",
      "dwell",
      "dwell",
      "dwell",
    ]);
    expect(sim.seconds).toBeCloseTo(Math.hypot(10, 5) / 10 + 2.5 + 10 + 3, 10);
    expect(sim.events[1]).toMatchObject({ water: true, abrasive: true });
    expect(sim.events.at(-1)).toMatchObject({ water: false, abrasive: false });
  });
  it("interpolates travel, holds the pierce point during dwell, and clamps seeking at the ends", () => {
    const sim = parseSimulation(code, 600),
      start = sim.events[2].start;
    expect(simulationAt(sim, start + 5).position).toEqual({ x: 15, y: 5 });
    expect(simulationAt(sim, sim.events[1].start + 1).position).toEqual({
      x: 10,
      y: 5,
    });
    expect(simulationAt(sim, -100).position).toEqual({ x: 0, y: 0 });
    expect(simulationAt(sim, Infinity)).toMatchObject({
      position: { x: 20, y: 5 },
      finished: true,
    });
  });
  it("retains modal axes and feeds and skips zero-time events correctly", () => {
    const sim = parseSimulation(
      "G90\nG21\nG0 X0 Y0\nM3\nM8\nG4 S0\nG1 X10 F60\nG1 Y-10\nM9\nM5",
    );
    expect(sim.seconds).toBe(20);
    expect(simulationAt(sim, 0).event.kind).toBe("cut");
    expect(simulationAt(sim, 15).position).toEqual({ x: 10, y: 5 });
  });
  it("parses actual posted sheets and independently agrees with cut/dwell timing and bed coordinates", () => {
    const job = readJob(
      JSON.parse(readFileSync("fixtures/posting/two-sheets.wam", "utf8")),
    );
    // Legacy capture has an 8.84 mm tab wider than its hole. Use the current
    // physical default for this timing/coordinate integration fixture.
    job.tabRules = {
      width: 1.016,
      count: 2,
      automaticWidth: false,
      minHoleArea: 0,
    };
    for (const file of postJob(job)) {
      const sim = parseSimulation(file.content),
        nc = inspectReferenceNc(file.content);
      const rapid = sim.events
        .filter((e) => e.kind === "rapid")
        .reduce((sum, e) => sum + e.end - e.start, 0);
      expect(sim.seconds - rapid).toBeCloseTo(
        nc.linearSeconds + nc.dwellSeconds,
        6,
      );
      expect(sim.events.filter((e) => e.kind === "pierce")).toHaveLength(
        file.operations,
      );
      expect(
        sim.events.filter((e) => e.kind === "cut").map((e) => e.to),
      ).toEqual(nc.moves.filter((m) => !m.rapid).map((m) => m.to));
    }
  });
  it("rejects unsupported motion modes, missing feeds and unsafe valve sequences", () => {
    for (const invalid of [
      "G1 X1 F60",
      "G90\nG20",
      "G90\nG21\nG2 X5",
      "G90\nG21\nM3\nM8\nG0 X5",
      "G90\nG21\nG1 X5 F60",
      "G90\nG21\nM3\nM8\nG1 X5",
      "G90\nG21\nG4 S-1",
      "G90\nG21\nM3\nM8\nG1 X5 F60",
    ]) {
      expect(() => parseSimulation(invalid)).toThrow();
    }
  });
});

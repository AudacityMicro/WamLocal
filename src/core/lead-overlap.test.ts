import { expect, it } from "vitest";
import { overlapProfile } from "./lead-overlap";
import { makePart, newProject, rectangle } from "./model";
import { planForPosting } from "./postprocessor";
import type { Move } from "./geometry";
const moves: Move[] = [
  { from: { x: 0, y: 0 }, to: { x: 20, y: 0 }, kind: "cut", partId: "p" },
  { from: { x: 20, y: 0 }, to: { x: 20, y: 10 }, kind: "cut", partId: "p" },
  { from: { x: 20, y: 10 }, to: { x: 0, y: 10 }, kind: "cut", partId: "p" },
  { from: { x: 0, y: 10 }, to: { x: 0, y: 0 }, kind: "cut", partId: "p" },
];
const length = (m: Move[]) =>
  m.reduce((s, m) => s + Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y), 0);
it("extends before the nominal entry and after the full closed circuit, including corners", () => {
  const result = overlapProfile(moves, true, 12, 3);
  expect(result[0].from).toEqual({ x: 2, y: 10 });
  expect(result.at(-1)!.to).toEqual({ x: 3, y: 0 });
  expect(length(result)).toBe(75);
  result.slice(1).forEach((m, i) => expect(m.from).toEqual(result[i].to));
  expect(overlapProfile(moves, false, 12, 3)).toBe(moves);
  expect(overlapProfile(moves, true)).toBe(moves);
});
it("never cuts across tabs or extends an entry beyond its contiguous cut region", () => {
  const tabbed = moves.map((m, i) => ({
    ...m,
    kind: i === 0 || i === 3 ? ("tab" as const) : ("cut" as const),
  }));
  expect(overlapProfile(tabbed, true, 12, 3)).toEqual(tabbed);
  const partial = moves.map((m, i) => ({
    ...m,
    kind: i === 2 ? ("tab" as const) : ("cut" as const),
  }));
  const result = overlapProfile(partial, true, 30, 30);
  expect(length(result)).toBe(100); // 60 + 10 before + 30 after; the bridge is intact.
  expect(result.filter((m) => m.kind === "tab")).toEqual(
    partial.filter((m) => m.kind === "tab"),
  );
});
it("uses contour overrides in the posted preview and counts extra cutting time", () => {
  const project = newProject();
  project.machineSettings = undefined;
  project.tabRules = undefined;
  project.material = {
    ...project.material,
    kerf: 0,
    lead: 0,
    feed: 60,
    tabCount: 0,
    cornerSlowdown: false,
    leadInOverlap: 2,
    leadOutOverlap: 3,
  };
  project.parts = [makePart("plate", [rectangle(20, 10)], 20, 20)];
  const base = planForPosting({
    ...project,
    material: { ...project.material, leadInOverlap: 0, leadOutOverlap: 0 },
  });
  const extended = planForPosting(project);
  expect(
    length(extended.operations[0].moves) - length(base.operations[0].moves),
  ).toBeCloseTo(5);
  expect((extended.minutes - base.minutes) * 60).toBeCloseTo(5);
  project.parts[0].contours[0].leadInOverlap = 0;
  project.parts[0].contours[0].leadOutOverlap = 1;
  const overridden = planForPosting(project);
  expect(
    length(overridden.operations[0].moves) - length(base.operations[0].moves),
  ).toBeCloseTo(1);
});

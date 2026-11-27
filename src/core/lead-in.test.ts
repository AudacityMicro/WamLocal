import { describe, it, expect } from "vitest";
import { circle, rectangle, makePart, newProject } from "./model";
import { distance, plan, transformed } from "./geometry";
import { leadInStart } from "./lead-in";
import { pointInPaths, movePathStart, pointOnPath } from "./path-math";

describe("scrap-side lead-ins", () => {
  it("puts circular hole pierces and the entire lead inside the hole for either winding", () => {
    for (const reverse of [false, true]) {
      const hole = { ...circle(8), hole: true };
      if (reverse) hole.points.reverse();
      const project = newProject();
      project.material = { ...project.material, kerf: 1, lead: 3, tabCount: 0 };
      project.parts = [
        {
          ...makePart("plate", [rectangle(50, 40), hole], 70, 70),
          rotation: 37,
          scale: 1.3,
        },
      ];
      const result = plan(project);
      const paths = transformed(project.parts[0]);
      const entry = result.moves[1];
      expect(entry.kind).toBe("cut");
      expect(distance(entry.from, entry.to)).toBeCloseTo(3, 5);
      for (let i = 0; i < 10; i++) {
        const p = {
          x: entry.from.x + ((entry.to.x - entry.from.x) * i) / 10,
          y: entry.from.y + ((entry.to.y - entry.from.y) * i) / 10,
        };
        expect(pointInPaths([paths[1].points], p)).toBe(true);
      }
      expect(result.pierces[0].warning).toBe(false);
    }
  });
  it("places outer leads in exterior scrap and preserves manual entry locations", () => {
    for (const reverse of [false, true]) {
      const outer = circle(10);
      if (reverse) outer.points.reverse();
      const target = pointOnPath(outer.points, true, 0.37);
      outer.points = movePathStart(outer.points, target);
      const start = leadInStart(outer, 2);
      expect(pointInPaths([outer.points], start)).toBe(false);
      expect(distance(start, target)).toBeCloseTo(2, 6);
      expect(distance(outer.points[0], target)).toBeLessThan(1e-10);
    }
  });
  it("centers the pierce rather than extending a long lead across a small hole", () => {
    const hole = { ...circle(2), hole: true };
    const start = leadInStart(hole, 20);
    expect(pointInPaths([hole.points], start)).toBe(true);
    expect(distance(start, hole.points[0])).toBeCloseTo(2, 5);
    const project = newProject();
    project.parts = [makePart("small hole", [hole], 30, 30)];
    project.material = { ...project.material, kerf: 0, lead: 20, tabCount: 0 };
    expect(plan(project).pierces[0].point.x).toBeCloseTo(32, 8);
    expect(plan(project).pierces[0].point.y).toBeCloseTo(32, 8);
  });
  it("retains zero lead and open centerline behavior", () => {
    const contour = circle(5);
    expect(leadInStart(contour, 0)).toEqual(contour.points[0]);
    expect(leadInStart({ ...contour, closed: false }, 4)).toEqual(
      contour.points[0],
    );
  });
});

import { describe, it, expect } from "vitest";
import { makePart, rectangle, newProject } from "./model";
import { transformed } from "./geometry";
import { pointOnPath } from "./path-math";
import { planForPosting } from "./postprocessor";
import { editableTabs, moveCutHandle } from "./part-cut-handles";
describe("editable part cut handles", () => {
  it("moves automatic tabs into manual overrides while preserving widths and other locations", () => {
    const project = newProject(),
      part = {
        ...makePart("plate", [rectangle(50, 30)], 30, 30),
        rotation: 27,
        scale: 1.5,
      };
    project.parts = [part];
    const tabs = editableTabs(part, 0, planForPosting(project));
    expect(tabs).toHaveLength(2);
    const target = pointOnPath(transformed(part)[0].points, true, 0.7);
    const moved = moveCutHandle(
      part,
      { kind: "tab", contourIndex: 0, tabIndex: 0, tabs },
      target,
      project,
    );
    expect(moved.contours[0].tabMode).toBe("manual");
    expect(moved.contours[0].tabs![0].position).toBeCloseTo(0.7, 8);
    expect(moved.contours[0].tabs![0].width).toBe(tabs[0].width);
    expect(moved.contours[0].tabs![1]).toEqual(tabs[1]);
    expect(part.contours[0].tabs).toBeUndefined();
  });
  it("moves a lead entry on the outline and changes length independently of tabs", () => {
    const project = newProject(),
      part = makePart(
        "plate",
        [{ ...rectangle(40, 30), tabMode: "none" }],
        30,
        30,
      );
    project.parts = [part];
    const contours = transformed(part),
      target = pointOnPath(contours[0].points, true, 0.5);
    const moved = moveCutHandle(
      part,
      { kind: "entry", contourIndex: 0, entryFraction: 0 },
      target,
      project,
    );
    expect(moved.contours[0].startPosition).toBeCloseTo(0.5, 9);
    expect(moved.contours[0].tabMode).toBe("none");
    project.material.leadStyle = "straight";
    const longer = moveCutHandle(
      moved,
      { kind: "lead", contourIndex: 0, entryFraction: 0.5 },
      { x: target.x + 5, y: target.y },
      project,
    );
    expect(longer.contours[0].lead).toBe(5);
    expect(
      planForPosting({ ...project, parts: [longer] }).operations.length,
    ).toBe(1);
    expect(
      editableTabs(longer, 0, planForPosting({ ...project, parts: [longer] })),
    ).toEqual([]);
  });
  it("honors area rules, bounds lead lengths and identifies the original contours in sorted operations", () => {
    const project = newProject(),
      part = makePart(
        "plate",
        [
          rectangle(40, 30),
          {
            ...rectangle(2, 2),
            hole: true,
            points: rectangle(2, 2).points.map((p) => ({
              x: p.x + 10,
              y: p.y + 10,
            })),
          },
        ],
        30,
        30,
      );
    project.parts = [part];
    project.tabRules = {
      width: 0.5,
      count: 2,
      automaticWidth: false,
      minHoleArea: 10,
    };
    const preview = planForPosting(project);
    expect(preview.operations[0].contourIndex).toBe(1);
    expect(editableTabs(part, 1, preview)).toEqual([]);
    expect(editableTabs(part, 0, preview)).toHaveLength(2);
    const moved = moveCutHandle(
      part,
      { kind: "lead", contourIndex: 0, entryFraction: 0 },
      { x: 999, y: 999 },
      project,
    );
    expect(moved.contours[0].lead).toBe(30);
  });
});

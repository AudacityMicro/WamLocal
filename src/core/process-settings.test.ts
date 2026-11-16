import { describe, it, expect } from "vitest";
import {
  newProject,
  makePart,
  rectangle,
  effectivePierceDiameter,
} from "./model";
import { plan, bounds } from "./geometry";
import { materialsCompatible, newJob, jobSchema, viewProject } from "./job";
import { defaultMachineSettings } from "./machine-settings";
import { initialMaterialLibrary } from "./material-library";
import { ORIGIN_ANCHORS, workOriginPoint, toWorkPoint } from "./work-origin";
import { unitFormat } from "../ui/display-units";
import { selectMaterialProfile, materialQuality } from "./material-selection";
import { packSheet } from "./nesting";

describe("machine and cutting allowances", () => {
  it("resolves absent and legacy zero pierce diameters at use time", () => {
    const p = newProject();
    p.material.lead = 0;
    p.material.tabCount = 0;
    p.parts = [
      { ...makePart("test", [rectangle(20, 10)], 20, 20), cut: "centerline" },
    ];
    for (const value of [undefined, 0]) {
      p.material.pierceDiameter = value;
      expect(plan(p).pierces[0].radius).toBe(p.material.kerf / 2);
      expect(plan(p).issues.join(" ")).toContain("pierce footprint may alter");
    }
    p.material.kerf = 2;
    expect(plan(p).pierces[0].radius).toBe(1);
    p.material.pierceDiameter = 3;
    expect(plan(p).pierces[0].radius).toBe(1.5);
    expect(effectivePierceDiameter({ kerf: 0, pierceDiameter: 0 })).toBe(0);
  });
  it("uses the captured WAM account kerf for Pro defaults", () => {
    expect(defaultMachineSettings("pro").kerf).toBeCloseTo(0.038 * 25.4, 8);
    expect(
      initialMaterialLibrary()
        .materials.filter((m) => m.preset)
        .every((m) => m.kerf === 0.038 * 25.4),
    ).toBe(true);
  });
  it("applies stock to leave per side, with the opposite sign on holes", () => {
    const p = newProject();
    p.material = { ...p.material, kerf: 0, lead: 0, tabCount: 0 };
    p.parts = [
      makePart(
        "plate",
        [
          rectangle(40, 30),
          {
            ...rectangle(10, 10),
            hole: true,
            points: rectangle(10, 10).points.map((v) => ({
              x: v.x + 10,
              y: v.y + 10,
            })),
          },
        ],
        30,
        30,
      ),
    ];
    for (const value of [1, -1]) {
      p.parts[0].stockToLeave = value;
      const groups: { x: number; y: number }[][] = [];
      for (const m of plan(p).moves) {
        if (m.kind === "rapid") groups.push([]);
        if (m.kind === "cut") groups.at(-1)!.push(m.from, m.to);
      }
      const outer = bounds(groups[1]);
      const hole = bounds(groups[0]);
      expect(outer.width).toBeCloseTo(40 + 2 * value, 3);
      expect(hole.width).toBeCloseTo(10 - 2 * value, 3);
      expect(p.parts[0].contours[0].points[0]).toEqual({ x: 0, y: 0 });
    }
  });
  it("honors an individual contour lead and its zero override", () => {
    const p = newProject();
    p.material.tabCount = 0;
    p.material.lead = 5;
    p.parts = [makePart("plate", [{ ...rectangle(30, 20), lead: 0 }], 30, 30)];
    const a = plan(p);
    delete p.parts[0].contours[0].lead;
    expect(plan(p).cutLength - a.cutLength).toBeCloseTo(5, 4);
  });
  it("keeps machine settings and allowances in a self-contained job", () => {
    const j = newJob("pro", {
      ...defaultMachineSettings("pro"),
      kerf: 2,
      abrasive: 200,
    });
    j.parts = [
      {
        ...makePart("plate", [rectangle()], 30, 30),
        stockToLeave: 0.3,
        quantity: 1,
        materialId: j.materials[0].id,
      },
    ];
    const saved = jobSchema.parse(JSON.parse(JSON.stringify(j)));
    const p = viewProject(saved, { kind: "part", id: j.parts[0].id });
    expect(p.parts[0].stockToLeave).toBe(0.3);
    expect(p.material.kerf).toBe(2);
    expect(p.parts[0].process?.abrasive).toBe(200);
  });
  it("uses machine limits for nesting and reports travel outside them", () => {
    const p = newProject();
    p.machineSettings = {
      ...defaultMachineSettings("pro"),
      width: 20,
      height: 20,
    };
    p.material = { ...p.material, kerf: 0, lead: 0, tabCount: 0 };
    p.stock.margin = 0;
    p.stock.spacing = 0;
    p.parts = [makePart("oversize", [rectangle(30, 10)], 30, 30)];
    expect(packSheet(p, false, 100).unplaced).toHaveLength(1);
    expect(plan(p).issues.join(" ")).toContain("maximum cutting area");
  });
  it("estimates abrasive consumed during cutting and pierce dwell", () => {
    const p = newProject();
    p.machineSettings = {
      ...defaultMachineSettings("pro"),
      kerf: 1,
      abrasive: 150,
    };
    p.material = { ...p.material, feed: 60, pierce: 60, lead: 0, tabCount: 0 };
    p.parts = [
      { ...makePart("test", [rectangle(10, 20)], 20, 20), cut: "centerline" },
    ];
    expect(plan(p).abrasiveGrams).toBeCloseTo(300);
  });
});
describe("legacy preset compatibility", () => {
  it("lets different cut qualities share the same physical stock even without a stock key", () => {
    const base = newJob("pro").materials[0];
    expect(
      materialsCompatible(
        { ...base, name: "Aluminum - 6061 \u00b7 medium", stockKey: undefined },
        { ...base, name: "Aluminum - 6061 \u00b7 fine", stockKey: undefined },
      ),
    ).toBe(true);
  });
});
describe("workspace preferences", () => {
  it("maps all nine work origins without changing sheet geometry", () => {
    const stock = { width: 100, height: 60 };
    ORIGIN_ANCHORS.forEach((workOrigin, i) => {
      expect(workOriginPoint({ stock, workOrigin })).toEqual({
        x: (i % 3) * 50,
        y: Math.floor(i / 3) * 30,
      });
    });
    expect(
      toWorkPoint({ stock, workOrigin: "center-center" }, { x: 20, y: 15 }),
    ).toEqual({ x: -30, y: -15 });
    expect(stock).toEqual({ width: 100, height: 60 });
  });
  it("converts display units and edits without changing source lengths", () => {
    const u = unitFormat("in");
    expect(u.length(25.4)).toBe("1 in");
    expect(u.toMM(u.toDisplay(355.6))).toBeCloseTo(355.6, 10);
    expect(unitFormat("mm").length(25.4)).toBe("25.4 mm");
  });
  it("preserves quality when changing stock material and uses actual profiles", () => {
    const records = initialMaterialLibrary().materials;
    const current = records.find((m) => m.preset?.quality === "fine")!;
    const result = selectMaterialProfile(
      records,
      current,
      "pro",
      "Brass - 260",
    );
    expect(materialQuality(result)).toBe("fine");
    expect(
      records.some((m) => m.id === result.id && m.feed === result.feed),
    ).toBe(true);
  });
});

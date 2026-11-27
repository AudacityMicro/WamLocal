import { describe, it, expect } from "vitest";
import { newJob, jobSchema, sheetProject, viewProject, readJob } from "./job";
import { setJobMaterial, setPartMaterial, editView, nestJob } from "./job-ops";
import { makePart, rectangle } from "./model";
import { plan, distance } from "./geometry";
import { defaultTabWidth } from "./tab-defaults";
import { unitFormat } from "../ui/display-units";
import {
  initialMaterialLibrary,
  extendMaterialLibrary,
} from "./material-library";
import { materialPresets } from "./material-presets";
import { planForPosting } from "./postprocessor";

function fixture() {
  const j = newJob();
  Object.assign(j.materials[0], { kerf: 0, lead: 0, feed: 100, pierce: 0 });
  j.tabRules = { width: 0.5, count: 2, automaticWidth: false, minHoleArea: 25 };
  j.parts = [
    {
      ...makePart("plate", [
        rectangle(20, 20),
        {
          ...rectangle(4, 4),
          hole: true,
          points: rectangle(4, 4).points.map((p) => ({
            x: p.x + 5,
            y: p.y + 5,
          })),
        },
      ]),
      materialId: j.materials[0].id,
      quantity: 1,
    },
  ];
  j.sheets[0].placements = [
    {
      id: "placement",
      partId: j.parts[0].id,
      x: 20,
      y: 20,
      rotation: 0,
      scale: 1,
    },
  ];
  return j;
}
const tabLength = (j: ReturnType<typeof fixture>) =>
  plan(sheetProject(j, j.sheets[0].id))
    .moves.filter((m) => m.kind === "tab")
    .reduce((sum, m) => sum + distance(m.from, m.to), 0);

describe("shared job material, sheets and tabs", () => {
  it("updates every part/sheet without moving placements and normalizes added sheets", () => {
    const j = fixture();
    j.sheets.push({
      ...structuredClone(j.sheets[0]),
      id: "second",
      placements: [],
    });
    const material = {
      ...j.materials[0],
      id: "aluminum",
      name: "Aluminum",
      thickness: 6,
    };
    const next = setJobMaterial(j, material);
    expect(next.parts.every((p) => p.materialId === material.id)).toBe(true);
    expect(next.sheets.every((s) => s.materialId === material.id)).toBe(true);
    expect(next.sheets[0].placements).toEqual(j.sheets[0].placements);
    next.sheets[0].stock.width = 200;
    next.sheets[1].stock.width = 100;
    expect(jobSchema.parse(next).sheets.map((s) => s.stock.width)).toEqual([
      200, 200,
    ]);
    expect(
      setPartMaterial(
        {
          ...next,
          materials: [...next.materials, { ...material, id: "other" }],
        },
        j.parts[0].id,
        "other",
      ).sheets.every((s) => s.materialId === "other"),
    ).toBe(true);
    expect(j.materials).not.toContainEqual(material);
  });
  it("propagates sheet edits even when editing a later sheet and round-trips rules", () => {
    const j = fixture();
    j.sheets.push({
      ...structuredClone(j.sheets[0]),
      id: "second",
      placements: [],
    });
    const view = { kind: "sheet" as const, id: "second" },
      project = viewProject(j, view);
    project.stock.width = 220;
    const next = editView(j, view, project);
    expect(next.sheets.map((s) => s.stock.width)).toEqual([220, 220]);
    expect(readJob(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it("omits automatic tabs below minimum hole area and includes the boundary", () => {
    const j = fixture();
    expect(tabLength(j)).toBeCloseTo(1, 6);
    j.tabRules!.minHoleArea = 16;
    expect(tabLength(j)).toBeCloseTo(2, 6);
    j.tabRules!.minHoleArea = 16.1;
    expect(tabLength(j)).toBeCloseTo(1, 6);
  });
  it("uses net physical part area at placed scale and includes the maximum boundary", () => {
    const j = fixture();
    j.tabRules!.maxPartArea = 384;
    expect(tabLength(j)).toBeCloseTo(1, 6);
    j.tabRules!.maxPartArea = 383.9;
    expect(tabLength(j)).toBe(0);
    j.tabRules!.maxPartArea = 500;
    j.sheets[0].placements[0].scale = 2;
    expect(tabLength(j)).toBe(0);
  });
  it("retains manual tabs as explicit overrides and shares rules with posting", () => {
    const j = fixture();
    j.tabRules!.maxPartArea = 1;
    Object.assign(j.parts[0].contours[1], {
      tabMode: "manual",
      tabs: [{ position: 0.2, width: 0.75 }],
    });
    expect(tabLength(j)).toBeCloseTo(0.75, 6);
    const project = sheetProject(j, j.sheets[0].id);
    expect(
      planForPosting(project).moves.filter((m) => m.kind === "tab"),
    ).toEqual(plan(project).moves.filter((m) => m.kind === "tab"));
    j.parts[0].contours[1].tabMode = "none";
    expect(tabLength(j)).toBe(0);
  });
  it("converts square units by 25.4 squared without changing stored areas", () => {
    const inches = unitFormat("in"),
      mm = unitFormat("mm");
    expect(inches.toDisplayArea(645.16)).toBeCloseTo(1, 12);
    expect(inches.toMM2(2)).toBeCloseTo(1290.32, 10);
    expect(mm.toDisplayArea(645.16)).toBe(645.16);
    expect(inches.areaUnit).toBe("in²");
    expect(mm.areaUnit).toBe("mm²");
  });
  it("decreases default widths with thickness while permitting custom widths beyond the range", () => {
    expect(defaultTabWidth(0.508)).toBe(1.016);
    expect(defaultTabWidth(8.128)).toBe(0.254);
    let previous = Infinity;
    for (let t = 0.01; t <= 30; t += 0.1) {
      const width = defaultTabWidth(t);
      expect(width).toBeGreaterThanOrEqual(0.254);
      expect(width).toBeLessThanOrEqual(1.016);
      expect(width).toBeLessThanOrEqual(previous);
      previous = width;
    }
    const j = fixture();
    j.tabRules!.width = 2;
    expect(jobSchema.parse(j).tabRules!.width).toBe(2);
    j.tabRules!.width = 0.1;
    expect(jobSchema.parse(j).tabRules!.width).toBe(0.1);
    j.tabRules!.automaticWidth = true;
    expect(
      setJobMaterial(j, { ...j.materials[0], thickness: 8.128 }).tabRules!
        .width,
    ).toBe(0.254);
    j.tabRules!.automaticWidth = false;
    expect(
      setJobMaterial(j, { ...j.materials[0], thickness: 8.128 }).tabRules!
        .width,
    ).toBe(0.1);
  });
  it("replaces legacy generated WAM tab widths while preserving user-edited widths", () => {
    const library = initialMaterialLibrary();
    expect(
      library.materials.every(
        (m) => m.tabWidth >= 0.254 && m.tabWidth <= 1.016,
      ),
    ).toBe(true);
    const reference = materialPresets.find((p) => p.tabWidth < 20)!;
    const m = library.materials.find((m) => m.id === `${reference.id}-fine`)!;
    const old = {
      ...m,
      tabWidth: reference.tabWidth,
      tabDefaultWidthMm: undefined,
    };
    const custom = {
      ...m,
      id: "custom-tabs",
      tabWidth: 3,
      source: "User-edited defaults",
    };
    const migrated = extendMaterialLibrary({
      ...library,
      materials: [old, custom],
    });
    expect(migrated.materials.find((m) => m.id === old.id)!.tabWidth).toBe(
      defaultTabWidth(m.thickness),
    );
    expect(migrated.materials.find((m) => m.id === custom.id)!.tabWidth).toBe(
      3,
    );
  });
});

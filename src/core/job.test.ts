import { describe, it, expect } from "vitest";
import { newProject, makePart, rectangle, circle } from "./model";
import {
  newJob,
  readJob,
  sheetProject,
  viewProject,
  jobSchema,
  placedCount,
} from "./job";
import {
  editView,
  placeDefinition,
  setPartQuantity,
  setPartMaterial,
  nestJob,
  jobIssues,
  newDefinition,
} from "./job-ops";
import { area, transformed, nest, plan } from "./geometry";
import {
  packSheet,
  polygonIntersectionArea,
  nestingFootprint,
  partsOverlap,
} from "./nesting";

describe("job hierarchy and migration", () => {
  it("allows different process presets on the same physical stock and uses per-part feeds", () => {
    const job = newJob("pro"),
      base = job.materials[0];
    Object.assign(base, {
      id: "coarse",
      name: "Coarse preset",
      stockKey: "6061",
      kerf: 0,
      lead: 0,
      tabCount: 0,
      pierce: 0,
      feed: 100,
    });
    job.materials.push({ ...base, id: "fine", name: "Fine preset", feed: 50 });
    job.sheets[0].materialId = base.id;
    job.parts = [
      {
        ...makePart("one", [rectangle(10, 10)]),
        materialId: "coarse",
        quantity: 1,
      },
      {
        ...makePart("two", [rectangle(10, 10)]),
        materialId: "fine",
        quantity: 1,
      },
    ];
    job.sheets[0].placements = job.parts.map((p, i) => ({
      id: `placement-${i}`,
      partId: p.id,
      x: 10 + i * 30,
      y: 10,
      rotation: 0,
      scale: 1,
    }));
    expect(() => jobSchema.parse(job)).not.toThrow();
    const preview = plan(sheetProject(job, job.sheets[0].id));
    expect(preview.minutes).toBeCloseTo(1.2, 8);
    expect(
      new Set(preview.moves.filter((m) => m.kind === "cut").map((m) => m.feed)),
    ).toEqual(new Set([100, 50]));
    job.materials[1].thickness = 4;
    expect(() => jobSchema.parse(job)).toThrow();
  });
  it("migrates legacy rotated/scaled geometry without moving or discarding it", () => {
    const old = newProject();
    old.name = "Legacy";
    old.parts = [
      {
        ...makePart(
          "irregular",
          [
            {
              ...rectangle(40, 20),
              points: rectangle(40, 20).points.map((p) => ({
                x: p.x + 7,
                y: p.y - 3,
              })),
            },
          ],
          60,
          80,
        ),
        rotation: 33,
        scale: 1.4,
      },
    ];
    const migrated = readJob(JSON.parse(JSON.stringify(old))),
      render = sheetProject(migrated, migrated.sheets[0].id);
    const before = transformed(old.parts[0])[0].points,
      after = transformed(render.parts[0])[0].points;
    for (let i = 0; i < before.length; i++) {
      expect(after[i].x).toBeCloseTo(before[i].x, 9);
      expect(after[i].y).toBeCloseTo(before[i].y, 9);
    }
    expect(migrated.parts[0].quantity).toBe(1);
    expect(readJob(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });
  it("keeps reusable part edits independent from placements and propagates them", () => {
    let job = readJob({
      ...newProject(),
      parts: [makePart("plate", [rectangle(40, 20)])],
    });
    job = setPartQuantity(job, job.parts[0].id, 2);
    job = placeDefinition(job, job.parts[0].id, job.sheets[0].id);
    const def = job.parts[0],
      view = { kind: "part" as const, id: def.id },
      project = viewProject(job, view);
    project.parts[0].contours[0].cut = "centerline";
    project.parts[0].contours[0].tabs = [{ position: 0.25, width: 3 }];
    project.parts[0].contours[0].tabMode = "manual";
    const edited = editView(job, view, project),
      placed = sheetProject(edited, edited.sheets[0].id);
    expect(placed.parts).toHaveLength(2);
    expect(
      placed.parts.every(
        (p) =>
          p.contours[0].cut === "centerline" &&
          p.contours[0].tabs?.[0].width === 3,
      ),
    ).toBe(true);
    expect(edited.sheets[0].placements).toEqual(job.sheets[0].placements);
  });
  it("enforces quantities and material matching across sheets", () => {
    let job = readJob({
      ...newProject(),
      parts: [makePart("plate", [rectangle()])],
    });
    const def = job.parts[0];
    expect(() => placeDefinition(job, def.id, job.sheets[0].id)).toThrow(
      /requested copies/,
    );
    job = setPartQuantity(job, def.id, 3);
    job = placeDefinition(job, def.id, job.sheets[0].id);
    job = placeDefinition(job, def.id, job.sheets[0].id);
    expect(placedCount(job, def.id)).toBe(3);
    job = setPartQuantity(job, def.id, 1);
    expect(placedCount(job, def.id)).toBe(1);
    job.materials.push({
      ...job.materials[0],
      id: "other",
      name: "Other stock",
    });
    job = setPartMaterial(job, def.id, "other");
    expect(placedCount(job, def.id)).toBe(0);
    expect(() => placeDefinition(job, def.id, job.sheets[0].id)).toThrow(
      /same material/,
    );
    const bad = structuredClone(job);
    bad.sheets[0].placements.push({
      id: "bad",
      partId: def.id,
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
    });
    expect(() => jobSchema.parse(bad)).toThrow();
  });
  it("supports blank new parts and checks WCS against the machine bed", () => {
    const job = newJob(),
      created = newDefinition(job, job.materials[0].id);
    expect(
      viewProject(created.job, { kind: "part", id: created.partId }).parts,
    ).toEqual([]);
    expect(() =>
      placeDefinition(created.job, created.partId, job.sheets[0].id),
    ).toThrow(/geometry/);
    job.sheets[0].wcs = { x: 25, y: 20 };
    expect(jobIssues(job).join(" ")).toMatch(/WAZER bed/);
  });
  it("nests requested copies across multiple matching sheets", () => {
    const job = readJob({
      ...newProject(),
      stock: { width: 100, height: 70, margin: 3, spacing: 2 },
      parts: [makePart("plate", [rectangle(70, 40)])],
    });
    job.parts[0].quantity = 3;
    const result = nestJob(job);
    expect(result.sheets.length).toBe(3);
    expect(placedCount(result, job.parts[0].id)).toBe(3);
    expect(job.sheets.length).toBe(1);
  });
});
describe("SVGnest regression and process settings", () => {
  it("wraps a manual tab across the contour seam without changing its width", () => {
    const p = newProject();
    p.material.tabCount = 0;
    p.parts = [
      {
        ...makePart("seam", [
          {
            ...rectangle(20, 20),
            cut: "centerline",
            tabMode: "manual",
            tabs: [{ position: 0, width: 4 }],
          },
        ]),
        cut: "centerline",
      },
    ];
    const result = plan(p);
    expect(
      result.moves
        .filter((m) => m.kind === "tab")
        .reduce(
          (sum, m) => sum + Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y),
          0,
        ),
    ).toBeCloseTo(4, 8);
  });
  it("fits the circular-part example despite overlapping bounding rectangles", () => {
    const p = newProject();
    p.stock = { width: 100, height: 100, margin: 8, spacing: 2 };
    p.parts = [
      makePart("one", [circle(21.7)]),
      makePart("two", [circle(21.7)]),
    ];
    const result = packSheet(p);
    expect(result.unplaced).toHaveLength(0);
    expect(result.provider).toMatch(/SVGnest/);
    expect(partsOverlap(result.parts[0], result.parts[1])).toBe(false);
    const footprints = result.parts.map((part) =>
      nestingFootprint(
        part,
        Math.max(p.material.lead, p.material.kerf / 2) + p.stock.spacing / 2,
      ).map((v) => ({ x: v.x + part.x, y: v.y + part.y })),
    );
    expect(
      polygonIntersectionArea([footprints[0]], [footprints[1]]),
    ).toBeLessThan(1e-5);
    expect(plan({ ...p, parts: result.parts }).issues).toEqual([]);
  }, 15000);
  it("projects manual tabs onto compensated contours and keeps the requested gap width", () => {
    const p = newProject();
    p.material.tabCount = 0;
    p.parts = [
      makePart("plate", [
        {
          ...rectangle(40, 20),
          tabMode: "manual",
          tabs: [{ position: 0.1, width: 3 }],
          startPosition: 0.6,
        },
      ]),
    ];
    const result = plan(p),
      tabs = result.moves.filter((m) => m.kind === "tab");
    expect(
      tabs.reduce(
        (sum, m) => sum + Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y),
        0,
      ),
    ).toBeCloseTo(3, 6);
    const center = {
      x: (tabs[0].from.x + tabs[0].to.x) / 2,
      y: (tabs[0].from.y + tabs[0].to.y) / 2,
    };
    expect(center.x).toBeCloseTo(27, 2);
    expect(center.y).toBeCloseTo(15 - p.material.kerf / 2, 2);
  });
  it("honors contour kerf overrides independently of the part default", () => {
    const p = newProject();
    p.material.tabCount = 0;
    p.parts = [
      makePart("plate", [{ ...rectangle(40, 20), cut: "centerline" }]),
    ];
    expect(plan(p).cutLength).toBeCloseTo(120, 8);
  });
  it("warns for an oversized pierce and clears the warning with a sufficiently long lead", () => {
    const p = newProject();
    p.material.pierceDiameter = 3;
    p.material.lead = 0;
    p.parts = [makePart("plate", [rectangle(40, 20)], 50, 50)];
    expect(plan(p).issues.join(" ")).toMatch(/pierce footprint may alter/);
    p.material.lead = 10;
    expect(plan(p).issues.join(" ")).not.toMatch(/pierce footprint may alter/);
    expect(plan(p).pierces[0].radius).toBe(1.5);
  });
});

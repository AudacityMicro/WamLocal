import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { importDxf } from "./import";
import {
  classifyImportedContours,
  deduplicateContours,
} from "./import-contours";
import { area, bounds, plan } from "./geometry";
import { newProject, rectangle, makePart, circle, type Contour } from "./model";
import { newJob, jobSchema } from "./job";
import { planForPosting, postJob } from "./postprocessor";
import { placeDefinition } from "./job-ops";
import { parseSimulation } from "./gcode-simulation";
import { smallHolePierce, leadInStart, curvedLead } from "./lead-in";
import { pointInPaths } from "./path-math";
const shim = () =>
  importDxf(
    readFileSync("fixtures/dxf/shim-duplicate.dxf", "utf8"),
    "Shim.dxf",
  );
it("imports the supplied doubled DXF as one outside profile and five holes, compensating toward scrap", () => {
  const p = shim();
  expect(p.contours).toHaveLength(6);
  expect(p.contours.filter((c) => c.hole)).toHaveLength(5);
  const project = newProject();
  project.material = {
    ...project.material,
    kerf: 0.2,
    pierceDiameter: 0.2,
    tabCount: 0,
    lead: 2,
  };
  project.parts = [{ ...p, x: 20, y: 20 }];
  const result = plan(project);
  expect(result.contourPlans).toHaveLength(6);
  for (const cp of result.contourPlans) {
    const original = p.contours[cp.contourIndex];
    expect(Math.abs(area(cp.contour.points)))[
      original.hole ? "toBeLessThan" : "toBeGreaterThan"
    ](Math.abs(area(original.points)));
  }
  const posted = planForPosting(project);
  expect(posted.operations).toHaveLength(6);
  expect(posted.pierces).toHaveLength(6);
});
it("repairs doubled contours in saved jobs without reclassifying nonduplicate manual roles", () => {
  const p = shim(),
    job = newJob();
  job.parts = [
    {
      ...p,
      quantity: 1,
      materialId: job.materials[0].id,
      contours: [...p.contours, ...structuredClone(p.contours)].map((c) => ({
        ...c,
        hole: !c.hole,
      })),
    },
  ];
  const fixed = jobSchema.parse(job);
  expect(fixed.parts[0].contours).toHaveLength(6);
  expect(fixed.parts[0].contours.filter((c) => c.hole)).toHaveLength(5);
  fixed.parts[0].contours[0].hole = true;
  expect(jobSchema.parse(fixed).parts[0].contours[0].hole).toBe(true);
});
it("posts the supplied shim with two undersize holes as centroid pierces and no perimeter motion", () => {
  let job = newJob();
  job.machineSettings = {
    kerf: 0.9652,
    abrasive: 150,
    width: 460,
    height: 305,
  };
  job.tabRules!.count = 0;
  const part = { ...shim(), materialId: job.materials[0].id, quantity: 1 };
  job.parts = [part];
  job = placeDefinition(job, part.id, job.sheets[0].id);
  const posted = postJob(job)[0];
  expect(posted.operations).toBe(6);
  expect(posted.pierceOnlyOperations).toBe(2);
  expect(posted.pierceSeconds).toBe(30);
  const groups = posted.content
    .split(/\r?\nM3\r?\n/)
    .slice(1)
    .map((s) => s.split(/\r?\nM5/)[0]);
  expect(groups).toHaveLength(6);
  expect(groups.filter((s) => !/^G1 /m.test(s))).toHaveLength(2);
  const simulation = parseSimulation(posted.content);
  expect(simulation.events.filter((e) => e.kind === "pierce")).toHaveLength(6);
});
it("merges reversed overlapping lines, subdivided lines and cyclic/reversed closed paths, retaining nearby distinct profiles", () => {
  const line: Contour = {
    closed: false,
    hole: false,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
  };
  const rect = rectangle(20, 10),
    reversed = {
      ...rect,
      points: [...rect.points.slice(2), ...rect.points.slice(0, 2)].reverse(),
    };
  const unique = deduplicateContours([
    line,
    { ...line, points: [...line.points].reverse() },
    { ...line, points: [line.points[0], { x: 5, y: 0 }, line.points[1]] },
    rect,
    reversed,
    { ...line, points: line.points.map((p) => ({ ...p, y: 0.001 })) },
  ]);
  expect(unique).toHaveLength(3);
  expect(
    classifyImportedContours([rectangle(20, 20), rectangle(20, 20)]),
  ).toHaveLength(1);
});
it.each(["straight", "arc"] as const)(
  "pierces small round and non-round holes at their area centroid with %s leads, independent of tabs",
  (style) => {
    for (const holes of [
      [{ ...circle(1), hole: true }],
      [
        {
          closed: true,
          hole: true,
          points: [
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 0, y: 2 },
          ],
        },
      ],
    ]) {
      const hole = holes[0],
        center = smallHolePierce(hole, 2)!;
      expect(center).toBeDefined();
      expect(center.x).toBeCloseTo(1, 6);
      expect(center.y).toBeCloseTo(hole.points.length === 3 ? 2 / 3 : 1, 6);
      expect(leadInStart(hole, 2)).toEqual(center);
      expect(curvedLead(hole, 2)[0]).toEqual(center);
      const project = newProject();
      project.material = {
        ...project.material,
        kerf: 0,
        pierceDiameter: 0.1,
        tabCount: 0,
        lead: 2,
        leadStyle: style,
      };
      project.parts = [
        makePart(
          "Plate",
          [
            rectangle(30, 30),
            {
              ...hole,
              points: hole.points.map((p) => ({ x: p.x + 10, y: p.y + 10 })),
            },
          ],
          20,
          20,
        ),
      ];
      const result = planForPosting(project),
        op = result.operations.find(
          (o) =>
            Math.hypot(
              o.start.x - (center.x + 30),
              o.start.y - (center.y + 30),
            ) < 0.0001,
        );
      expect(op).toBeDefined();
    }
  },
);
it("uses an interior fallback when a concave hole centroid is outside and does not center large or disabled leads", () => {
  const c: Contour = {
    closed: true,
    hole: true,
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 4 },
      { x: 0, y: 4 },
    ],
  };
  const center = smallHolePierce(c, 3)!;
  expect(pointInPaths([c.points], center)).toBe(true);
  expect(smallHolePierce({ ...circle(10), hole: true }, 2)).toBeUndefined();
  expect(smallHolePierce(c, 0)).toBeUndefined();
});
it("keeps small-hole leads out of a retained island at the hole center", () => {
  const hole = {
      ...circle(2),
      hole: true,
      points: circle(2).points.map((p) => ({ x: p.x + 10, y: p.y + 10 })),
    },
    island = {
      ...circle(0.5),
      points: circle(0.5).points.map((p) => ({ x: p.x + 11.5, y: p.y + 11.5 })),
    };
  const project = newProject();
  project.material = {
    ...project.material,
    kerf: 0,
    pierceDiameter: 0.1,
    lead: 2,
    tabCount: 0,
    leadStyle: "straight",
  };
  project.parts = [
    makePart("Island", [rectangle(30, 30), hole, island], 20, 20),
  ];
  const op = planForPosting(project).operations.find(
    (op) => op.contourIndex === 1,
  )!;
  expect(
    pointInPaths([island.points], { x: op.start.x - 20, y: op.start.y - 20 }),
  ).toBe(false);
});

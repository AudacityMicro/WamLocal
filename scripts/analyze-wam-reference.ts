import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  newProject,
  makePart,
  rectangle,
  circle,
  type Contour,
  type Project,
} from "../src/core/model";
import { plan, bounds } from "../src/core/geometry";
import { inspectReferenceNc } from "../src/core/nc-inspect";

export const cases = [
  "sq-centerline",
  "sq-outside",
  "sq-tabs-leads",
  "plate-hole-valid",
  "open-centerline",
];
export const root = new URL("../fixtures/wam-reference/", import.meta.url);
export async function compareCase(name: string) {
  const source = await readFile(new URL(`pro/${name}.gcode`, root), "utf8");
  const workspace = JSON.parse(
    await readFile(new URL(`pro/${name}.wzr`, root), "utf8"),
  );
  const nc = inspectReferenceNc(source);
  let contours: Contour[], width: number, height: number;
  if (name === "plate-hole-valid") {
    width = 60;
    height = 40;
    contours = [
      rectangle(60, 40),
      {
        ...circle(10),
        hole: true,
        points: circle(10).points.map((p) => ({ x: p.x + 20, y: p.y + 10 })),
      },
    ];
  } else if (name === "open-centerline") {
    width = 50;
    height = 20;
    contours = [
      {
        closed: false,
        hole: false,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 20 },
        ],
      },
    ];
  } else {
    width = 50;
    height = 50;
    contours = [rectangle(50, 50)];
  }
  const p = newProject();
  p.machine = "pro";
  p.name = name;
  const material = workspace.selectedMaterial.material;
  const instance = workspace.placements[0].instances[0];
  const part = makePart(
    name,
    contours,
    (instance.position.x + workspace.placements[0].RSTBB.originalMinX) * 25.4,
    (instance.position.y + workspace.placements[0].RSTBB.originalMinY) * 25.4,
  );
  part.id = name;
  part.rotation = instance.rotation;
  part.scale = instance.scale;
  part.cut = workspace.offsets[0].type.toLowerCase();
  p.parts = [part];
  const tabs = workspace.tabs[0];
  p.material = {
    name: material.name,
    thickness: 0.11811 * 25.4,
    feed: material.speedMode.mediumRate.value,
    pierce: material.pierceTime.value,
    kerf: 0.038 * 25.4,
    tabWidth: tabs.tabSize * 25.4,
    tabCount: tabs.type === "none" ? 0 : tabs.tabCount,
    lead: tabs.enableLeads ? material.defaultLeadDist.value : 0,
  };
  const local = plan(p);
  const endpoints = local.moves
    .filter((m) => m.kind === "cut")
    .flatMap((m) => [m.from, m.to]);
  return {
    project: p,
    nc,
    local,
    summary: {
      name,
      machine: "pro",
      sourceFile: workspace.fileList.files[0].filename,
      feed: p.material.feed,
      pierceSeconds: p.material.pierce,
      kerf: p.material.kerf,
      wamCutLength: nc.cutLength,
      localCutLength: local.cutLength,
      cutLengthDifference: local.cutLength - nc.cutLength,
      wamBounds: nc.bounds,
      localBounds: endpoints.length ? bounds(endpoints) : null,
      wamDeclaredSeconds: nc.declaredSeconds,
      wamLinearPlusDwellSeconds: nc.linearSeconds + nc.dwellSeconds,
      localEstimatedSeconds: local.minutes * 60,
      wamSegments: nc.segments,
      localTabLength: local.moves
        .filter((m) => m.kind === "tab")
        .reduce(
          (s, m) => s + Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y),
          0,
        ),
      localIssues: local.issues,
    },
  };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`))
) {
  const results = await Promise.all(cases.map(compareCase));
  const report = {
    capturedDate: "2026-11-08",
    wamVersion: "2.5.0",
    machine: "Pro",
    desktopStatus: "Not captured: account lists only one Pro machine",
    results: results.map((r) => r.summary),
  };
  await writeFile(
    new URL("comparison.json", root),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { newProject, makePart } from "../src/core/model";
import { cases, compareCase, root } from "./analyze-wam-reference";
import { postJob } from "../src/core/postprocessor";
import { readJob, sheetProject } from "../src/core/job";
import { plan } from "../src/core/geometry";
import { auditNc } from "../src/core/nc-audit";
import { createHash } from "node:crypto";

export const freshCases = ["cmp020c", "cmp020m", "cmp020f", "cmp020t", "cmp020i", "cmp020r"];
export const comparisonVersion = "0.8.1";
export async function comparePostedReference(name: string) {
  const fresh = freshCases.includes(name), directory = fresh ? "fresh-2026-11-16" : "pro";
  const workspace = JSON.parse(await readFile(new URL(`${directory}/${name}.wzr`, root), "utf8"));
  const reference = await readFile(new URL(`${directory}/${name}.gcode`, root), "utf8");
  let project;
  if (!fresh) project = (await compareCase(name)).project;
  else {
    const imported = readJob(JSON.parse(await readFile(new URL(`${directory}/local-svg-import.wam`, root), "utf8")));
    const contours = imported.parts[0].contours.map(c => ({ ...c, points: c.points.map(p => ({ x: p.x - 30, y: p.y - 20 })) }));
    const instance = workspace.placements[0].instances[0], material = workspace.selectedMaterial.material, tabs = workspace.tabs[0];
    project = newProject(); project.name = name; project.machine = "pro";
    const part = makePart(name, contours, instance.position.x * 25.4, instance.position.y * 25.4);
    part.id = name; part.rotation = instance.rotation; part.scale = instance.scale; part.cut = workspace.offsets[0].type.toLowerCase();
    project.parts = [part];
    project.material = { name: material.name, thickness: material.thickness.value * 25.4, feed: material.speedMode[workspace.selectedMaterial.quality].value, pierce: material.pierceTime.value, kerf: 0.9652, tabWidth: tabs.tabSize * 25.4, tabCount: tabs.type === "none" ? 0 : tabs.tabCount, lead: tabs.enableLeads ? material.defaultLeadDist.value : 0 };
  }
  const job = readJob(project), posted = postJob(job)[0];
  const wam = auditNc(reference), local = auditNc(posted.content);
  const parameters = workspace.tabs[0];
  const wamGaps = parameters.type === "none" ? [] : parameters.tabLocations.flatMap((tabs: any[], contour: number) => tabs.map((t) => ({ contour, gapMm: Math.abs(t.tabEnd.pathDistance - t.tabStart.pathDistance) * 25.4 })));
  const plans = plan(sheetProject(job, job.sheets[0].id));
  const localGaps = plans.contourPlans.map((cp, contour) => ({ contour, hole: cp.contour.hole, gapMm: cp.moves.filter((m) => m.kind === "tab").reduce((n, m) => n + Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y), 0) }));
  const brief = (nc: ReturnType<typeof auditNc>) => ({ cutLengthMm: nc.cutLength, operations: nc.segments, linearSeconds: nc.linearSeconds, dwellSeconds: nc.dwellSeconds, programmedSeconds: nc.linearSeconds + nc.dwellSeconds, declaredSeconds: nc.declaredSeconds, pierceDwells: nc.pierceDwells, feedMinimum: nc.feedMinimum, feedMaximum: nc.feedMaximum, feedLevels: nc.feedLevels.length, bounds: nc.bounds, processErrors: nc.errors, counts: nc.counts });
  return { name, job, reference, posted, wam, local, summary: {
    name, captureDate: fresh ? "2026-11-16" : "2026-11-08", importedSvg: fresh, cutMode: project.parts[0].cut, rotation: project.parts[0].rotation, scale: project.parts[0].scale, quality: workspace.selectedMaterial.quality, tabCountPerContour: project.material.tabCount, leadMm: project.material.lead, material: project.material.name, thicknessMm: project.material.thickness, nominalFeed: project.material.feed, pierceSeconds: project.material.pierce, kerfMm: project.material.kerf,
    nominalTabWidthMm: project.material.tabWidth, wamGaps, localGaps, wam: brief(wam), local: brief(local),
    deltas: { lengthMm: local.cutLength - wam.cutLength, programmedSeconds: local.linearSeconds + local.dwellSeconds - wam.linearSeconds - wam.dwellSeconds, operationCount: local.segments - wam.segments },
    hashes: { wam: createHash("sha256").update(reference).digest("hex"), local: createHash("sha256").update(posted.content).digest("hex") }, warnings: posted.warnings,
  } };
}
export async function runPostedComparison() {
  const folder = new URL(`posting-${comparisonVersion}/`, root); await mkdir(folder, { recursive: true });
  const results = [];
  for (const name of [...cases, ...freshCases]) {
    const r = await comparePostedReference(name); results.push(r.summary);
    await writeFile(new URL(`${name}.local.gcode`, folder), r.posted.content);
    await writeFile(new URL(`${name}.local.wam`, folder), JSON.stringify(r.job, null, 2) + "\n");
    await writeFile(new URL(`${name}.paths.json`, folder), JSON.stringify({ wam: r.wam.moves, local: r.local.moves }, null, 2));
  }
  const report = { localVersion: comparisonVersion, machine: "pro", sourceWamVersion: "2.5.0", referenceCaptureDates: ["2026-11-08", "2026-11-16"], physicalCutTested: false, results };
  await writeFile(new URL("comparison.json", folder), JSON.stringify(report, null, 2) + "\n");
  console.log(results.map((r) => ({ name: r.name, wamMm: +r.wam.cutLengthMm.toFixed(3), localMm: +r.local.cutLengthMm.toFixed(3), wamSeconds: +r.wam.programmedSeconds.toFixed(2), localSeconds: +r.local.programmedSeconds.toFixed(2), gaps: r.wamGaps, localGaps: r.localGaps, errors: [...r.wam.processErrors, ...r.local.processErrors] })));
  return report;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await runPostedComparison();

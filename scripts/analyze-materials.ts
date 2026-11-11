import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  materialParameter,
  materialParameterPaths,
  type MaterialCapture,
} from "../src/core/material-reference";
const root = new URL("../fixtures/wam-reference/materials/", import.meta.url);
const samples = JSON.parse(
  await readFile(new URL("samples.json", root), "utf8"),
) as MaterialCapture[];
const training = JSON.parse(
  await readFile(new URL("training-samples.json", root), "utf8"),
) as MaterialCapture[];
const limits = JSON.parse(
  await readFile(new URL("../material-limits.json", root), "utf8"),
).materials as {
  name: string;
  category: string;
  min: number;
  max: number;
  step: number;
}[];
const trainingKeys = new Set(training.map((s) => `${s.name}|${s.thicknessIn}`));
const errors: string[] = [],
  outliers: { name: string; thicknessIn: number; tabWidthMm: number }[] = [],
  manifest: { file: string; sha256: string }[] = [];
for (const s of samples) {
  if (
    s.data.name !== s.name ||
    s.data.machineType !== "pro" ||
    s.data.thickness.unit !== "in" ||
    Math.abs(s.data.thickness.value - s.thicknessIn) > 1e-10
  )
    errors.push(`Capture mismatch: ${s.name} ${s.thicknessIn}`);
  for (const path of materialParameterPaths) {
    const v = materialParameter(s.data, path);
    if (!Number.isFinite(v) || v < 0)
      errors.push(`Invalid ${path}: ${s.name} ${s.thicknessIn}`);
  }
  if (!(
    s.data.speedMode.roughRate.value >= s.data.speedMode.mediumRate.value &&
    s.data.speedMode.mediumRate.value >= s.data.speedMode.fineRate.value
  ))
    errors.push(`Quality order: ${s.name} ${s.thicknessIn}`);
  if (s.data.defaultTabWidth.value > 460)
    outliers.push({
      name: s.name,
      thicknessIn: s.thicknessIn,
      tabWidthMm: s.data.defaultTabWidth.value,
    });
  const file =
    "m" +
    String(s.materialIndex).padStart(2, "0") +
    "-t" +
    String(s.thicknessIn).replace(".", "p") +
    ".wzr";
  const raw = await readFile(new URL("captures/" + file, root));
  const actual = JSON.parse(raw.toString()).selectedMaterial.material;
  for (const path of materialParameterPaths)
    if (materialParameter(actual, path) !== materialParameter(s.data, path))
      errors.push(`Raw mismatch: ${file} ${path}`);
  manifest.push({
    file,
    sha256: createHash("sha256").update(raw).digest("hex"),
  });
}
// Deliberately simple candidate, evaluated only on independent thicknesses.
// This is a diagnostic baseline; it is NOT a production settings generator.
function predict(
  points: MaterialCapture[],
  t: number,
  path: (typeof materialParameterPaths)[number],
) {
  points = [...points].sort((a, b) => a.thicknessIn - b.thicknessIn);
  const hi = points.findIndex((p) => p.thicknessIn > t);
  if (hi <= 0) return null;
  const a = points[hi - 1],
    b = points[hi],
    alpha =
      (Math.log(t) - Math.log(a.thicknessIn)) /
      (Math.log(b.thicknessIn) - Math.log(a.thicknessIn));
  const av = materialParameter(a.data, path),
    bv = materialParameter(b.data, path);
  return av > 0 && bv > 0
    ? Math.exp(Math.log(av) * (1 - alpha) + Math.log(bv) * alpha)
    : av * (1 - alpha) + bv * alpha;
}
const materials = limits.map((limit) => {
  const rows = samples
    .filter((s) => s.name === limit.name)
    .sort((a, b) => a.thicknessIn - b.thicknessIn);
  const base = training.filter((s) => s.name === limit.name),
    holdout = rows.filter(
      (s) => !trainingKeys.has(`${s.name}|${s.thicknessIn}`),
    );
  const metrics = materialParameterPaths.map((path) => {
    let maxAbsoluteError = 0,
      maxRelativeError = 0,
      comparisons = 0;
    for (const row of holdout) {
      const v = predict(base, row.thicknessIn, path);
      if (v === null) continue;
      const actual = materialParameter(row.data, path);
      maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(v - actual));
      maxRelativeError = Math.max(
        maxRelativeError,
        Math.abs(v - actual) / Math.max(Math.abs(actual), 1e-9),
      );
      comparisons++;
    }
    return { path, comparisons, maxAbsoluteError, maxRelativeError };
  });
  return {
    ...limit,
    maxMm: limit.max * 25.4,
    captures: rows.length,
    training: base.length,
    holdout: holdout.length,
    thicknessesIn: rows.map((s) => s.thicknessIn),
    allThicknessParityVerified: false,
    interpolationBaseline: metrics,
  };
});
const report = {
  source: "WAM workspace exports through normal browser UI",
  wamVersion: "2.5.0",
  machine: "Pro",
  capturedDate: "2026-11-08",
  materials: materials.length,
  captures: samples.length,
  training: training.length,
  holdouts: samples.length - training.length,
  parameterValues: samples.length * materialParameterPaths.length,
  integrityErrors: errors,
  outOfBedTabDefaults: outliers,
  profiles: materials,
};
await writeFile(
  new URL("validation-report.json", root),
  JSON.stringify(report, null, 2) + "\n",
);
await writeFile(
  new URL("capture-hashes.json", root),
  JSON.stringify(manifest, null, 2) + "\n",
);
let markdown =
  "# Material coverage\n\nCaptured WAM 2.5.0 Pro values; arbitrary-thickness parity is **not verified**.\n\n| Material | Maximum (in) | Maximum (mm) | Captures | Independent checks |\n| --- | ---: | ---: | ---: | ---: |\n";
for (const m of materials)
  markdown += `| ${m.name} | ${m.max.toFixed(3)} | ${m.maxMm.toFixed(4)} | ${m.captures} | ${m.holdout} |\n`;
markdown += `\n${samples.length} captured thickness points; ${report.parameterValues} individual parameter values. Integrity errors: ${errors.length}. Tab defaults exceeding 460 mm: ${outliers.length}. See validation-report.json for per-field interpolation errors and the outliers.\n`;
await writeFile(new URL("COVERAGE.md", root), markdown);
console.log(
  JSON.stringify(
    {
      materials: report.materials,
      captures: report.captures,
      training: report.training,
      holdouts: report.holdouts,
      parameterValues: report.parameterValues,
      integrityErrors: errors,
      outOfBedTabDefaults: outliers.length,
      worstInterpolation: materials
        .map((m) => ({
          name: m.name,
          relative: Math.max(
            ...m.interpolationBaseline.map((v) => v.maxRelativeError),
          ),
        }))
        .sort((a, b) => b.relative - a.relative)
        .slice(0, 5),
    },
    null,
    2,
  ),
);
if (errors.length) process.exitCode = 1;

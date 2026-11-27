import { writeFile } from "node:fs/promises";
import { materialPresets } from "../src/core/material-presets";
import { interpolateMaterialCurve } from "../src/core/material-estimate";

const results = [...new Set(materialPresets.map((p) => p.name))].map((name) => {
  const rows = materialPresets
    .filter((p) => p.name === name)
    .sort((a, b) => a.thicknessMm - b.thicknessMm);
  const errors: {
    thicknessMm: number;
    feedRelative: number;
    pierceRelative: number;
    pierceSeconds: number;
    tabRelative: number;
    leadMm: number;
  }[] = [];
  for (let i = 1; i < rows.length - 1; i++) {
    const a = rows[i - 1],
      actual = rows[i],
      b = rows[i + 1];
    if (b.thicknessMm / a.thicknessMm > 2.01) continue;
    const prediction = interpolateMaterialCurve(
      rows.filter((p) => p !== actual),
      actual.thicknessMm,
    );
    errors.push({
      thicknessMm: actual.thicknessMm,
      feedRelative: Math.max(
        ...(["coarse", "medium", "fine"] as const).map((q) =>
          Math.abs(prediction.feeds[q] / actual.feeds[q] - 1),
        ),
      ),
      pierceRelative: Math.abs(prediction.pierce / actual.pierce - 1),
      pierceSeconds: Math.abs(prediction.pierce - actual.pierce),
      tabRelative: Math.abs(prediction.tabWidth / actual.tabWidth - 1),
      leadMm: Math.abs(prediction.lead - actual.lead),
    });
  }
  return { name, checks: errors.length, errors };
});
const report = {
  date: "2026-11-17",
  method:
    "Leave-one-out shape-preserving cubic diagnostics; each predicted thickness excluded from the curve references. Endpoints and brackets over 2.01:1 excluded. Not independent fresh capture validation.",
  machine: "pro",
  productionValidated: false,
  results,
};
await writeFile(
  "fixtures/wam-reference/materials/interpolation-diagnostics.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  results.map((r) => ({
    name: r.name,
    n: r.checks,
    maxFeedPct: Math.max(...r.errors.map((e) => e.feedRelative)) * 100,
    maxPiercePct: Math.max(...r.errors.map((e) => e.pierceRelative)) * 100,
    maxPierceSeconds: Math.max(...r.errors.map((e) => e.pierceSeconds)),
  })),
);

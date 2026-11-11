import { readFile, writeFile } from "node:fs/promises";
const samples = JSON.parse(
  await readFile(
    new URL(
      "../fixtures/wam-reference/materials/samples.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const presets = samples
  .map((s) => ({
    id: `pro-${s.materialIndex}-${s.thicknessIn}`,
    machine: "pro",
    name: s.name,
    category: s.category,
    thicknessIn: s.thicknessIn,
    thicknessMm: s.thicknessIn * 25.4,
    feeds: {
      coarse: s.data.speedMode.roughRate.value,
      medium: s.data.speedMode.mediumRate.value,
      fine: s.data.speedMode.fineRate.value,
    },
    pierce: s.data.pierceTime.value,
    abrasive: s.data.speedMode.abrasiveRate.value,
    tabWidth: s.data.defaultTabWidth.value,
    lead: s.data.defaultLeadDist.value,
  }))
  .sort(
    (a, b) => a.name.localeCompare(b.name) || a.thicknessIn - b.thicknessIn,
  );
await writeFile(
  new URL("../src/core/material-presets.json", import.meta.url),
  JSON.stringify(presets, null, 2) + "\n",
);
console.log(`Generated ${presets.length} reference presets`);

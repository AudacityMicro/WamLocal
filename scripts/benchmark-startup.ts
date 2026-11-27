import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import asar from "@electron/asar";
import { readLibraryFile } from "../src/desktop/material-library";
import { materialLibrarySchema } from "../src/core/job";
const require = createRequire(import.meta.url);
const parent = path.resolve("node_modules"),
  folder = await mkdtemp(path.join(parent, ".wam-startup-"));
try {
  const archive = path.resolve(
    process.env.WAM_STARTUP_BASELINE ??
      "release/mcp-workbench-0.15.0/win-unpacked/resources/app.asar",
  );
  const code = asar.extractFile(archive, "dist-electron/library.cjs");
  const baseline = path.join(folder, "baseline.cjs");
  await writeFile(baseline, code);
  const old = require(baseline) as { readLibraryFile: typeof readLibraryFile };
  const source = await readFile(
    process.env.WAM_PROFILE_LIBRARY ??
      path.join(process.env.APPDATA!, "wam-local", "material-library.json"),
    "utf8",
  );
  const fixture = path.join(folder, "library.json");
  await writeFile(fixture, source, "utf8");
  const trials: {
    beforeMs: number;
    afterMs: number;
    rendererValidationMs: number;
  }[] = [];
  for (let i = 0; i < 3; i++) {
    let t = performance.now();
    const before = await old.readLibraryFile(fixture);
    const beforeMs = performance.now() - t;
    t = performance.now();
    const after = await readLibraryFile(fixture);
    const afterMs = performance.now() - t;
    assert.deepEqual(
      after,
      before,
      "Optimized catalog must exactly preserve the previous release output",
    );
    t = performance.now();
    materialLibrarySchema.parse(after);
    const rendererValidationMs = performance.now() - t;
    trials.push({ beforeMs, afterMs, rendererValidationMs });
  }
  const median = (field: keyof (typeof trials)[number]) =>
    trials.map((t) => t[field]).sort((a, b) => a - b)[1];
  const beforeMs = median("beforeMs"),
    afterMs = median("afterMs");
  const report = {
    baselineVersion: "0.15.0",
    records: JSON.parse(source).materials.length,
    identicalCatalog: true,
    trials,
    median: {
      beforeMs,
      afterMs,
      rendererValidationMs: median("rendererValidationMs"),
      catalogSpeedup: beforeMs / afterMs,
    },
    note: "Same saved database copied once into a disposable fixture. Times measure catalog read/upgrade, not total app launch. Desktop also skips the previous localStorage rebuild, second renderer upgrade and startup rewrite.",
  };
  await writeFile(
    "artifacts/startup-comparison-0.15.1.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (
    path.dirname(folder) !== parent ||
    !path.basename(folder).startsWith(".wam-startup-")
  )
    throw Error("Unexpected benchmark folder");
  await rm(folder, { recursive: true, force: true });
}

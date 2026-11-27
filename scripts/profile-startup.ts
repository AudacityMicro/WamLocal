import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const start = performance.now();
const { initialMaterialLibrary, extendMaterialLibrary } =
  await import("../src/core/material-library");
const { materialLibrarySchema } = await import("../src/core/job");
const { readLibraryFile } = await import("../src/desktop/material-library");
const timings: any = { moduleImportMs: performance.now() - start };
const measure = async (name: string, fn: () => unknown | Promise<unknown>) => {
  const t = performance.now();
  const value = await fn();
  timings[name] = performance.now() - t;
  return value;
};
const initial = (await measure("initialLibraryMs", () =>
  initialMaterialLibrary(),
)) as any;
const userFile =
  process.env.WAM_PROFILE_LIBRARY ??
  path.join(process.env.APPDATA!, "wam-local", "material-library.json");
let raw: string;
try {
  raw = await readFile(userFile, "utf8");
} catch {
  raw = JSON.stringify(initial);
}
const parsed = await measure("jsonParseMs", () => JSON.parse(raw));
const validated = await measure("schemaParseMs", () =>
  materialLibrarySchema.parse(parsed),
);
const expanded = (await measure("expandSavedLibraryMs", () =>
  extendMaterialLibrary(validated as any),
)) as any;
await measure("mainReadLibraryMs", () => readLibraryFile(userFile));
await measure("rendererRepeatExpansionMs", () =>
  extendMaterialLibrary(materialLibrarySchema.parse(expanded)),
);
await measure("serializeLibraryMs", () => JSON.stringify(expanded));
const report = {
  timings,
  sourceBytes: raw.length,
  records: expanded.materials.length,
};
console.log(JSON.stringify(report, null, 2));
await writeFile(
  process.env.WAM_PROFILE_REPORT ?? "artifacts/startup-before.json",
  JSON.stringify(report, null, 2),
);

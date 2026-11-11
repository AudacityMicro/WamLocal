import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { materialLibrarySchema } from "../core/job";
import { initialMaterialLibrary } from "../core/material-library";
export async function readLibraryFile(file: string) {
  try {
    const raw = await readFile(file, "utf8");
    if (raw.length > 20_000_000) throw Error("Material library exceeds 20 MB");
    return materialLibrarySchema.parse(JSON.parse(raw));
  } catch (error: any) {
    if (error.code === "ENOENT") return initialMaterialLibrary();
    throw error;
  }
}
let pending: Promise<unknown> = Promise.resolve();
export function writeLibraryFile(file: string, value: unknown) {
  const work = pending.then(() => writeNow(file, value));
  pending = work.catch(() => {});
  return work;
}
async function writeNow(file: string, value: unknown) {
  const library = materialLibrarySchema.parse(value);
  const serialized = JSON.stringify(library, null, 2);
  if (serialized.length > 20_000_000)
    throw Error("Material database exceeds 20 MB");
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  await writeFile(temp, serialized, "utf8");
  await rename(temp, file);
  return library;
}

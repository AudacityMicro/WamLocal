import { writeFile, rename, unlink, lstat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PostedFile } from "../core/postprocessor";
import { validCutFilename } from "../core/cut-filename";
export { postJob } from "../core/postprocessor";

export async function writePostedFiles(
  directory: string,
  files: Pick<PostedFile, "filename" | "content">[],
  replace = false,
) {
  if (
    !files.length ||
    new Set(files.map((f) => f.filename.toLowerCase())).size !== files.length
  )
    throw Error("Empty or duplicate output filenames");
  const batch = files.map((f) => {
    if (!validCutFilename(f.filename))
      throw Error(
        "Cut filenames must be valid filenames ending in .gcode (maximum 240 characters).",
      );
    if (Buffer.byteLength(f.content) > 50_000_000)
      throw Error("A cut file exceeds 50 MB");
    const file = path.join(directory, f.filename),
      token = randomUUID();
    return {
      ...f,
      file,
      temp: file + ".tmp-" + token,
      backup: file + ".bak-" + token,
      backedUp: false,
      installed: false,
    };
  });
  for (const f of batch) {
    const existing = await lstat(f.file).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (
      existing &&
      (!replace || !existing.isFile() || existing.isSymbolicLink())
    )
      throw Error(
        `Cannot replace ${f.filename}. Choose a different destination or confirm replacement.`,
      );
  }
  try {
    for (const f of batch)
      await writeFile(f.temp, f.content, { encoding: "utf8", flag: "wx" });
    for (const f of batch) {
      if (replace) {
        try {
          await rename(f.file, f.backup);
          f.backedUp = true;
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      await rename(f.temp, f.file);
      f.installed = true;
    }
  } catch (error) {
    for (const f of [...batch].reverse()) {
      if (f.installed) await unlink(f.file).catch(() => {});
      if (f.backedUp) await rename(f.backup, f.file);
    }
    throw error;
  } finally {
    for (const f of batch) await unlink(f.temp).catch(() => {});
  }
  for (const f of batch) if (f.backedUp) await unlink(f.backup).catch(() => {});
  return batch.map((f) => f.file);
}

import { readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { readJob, jobSchema } from "../core/job";
const MAX_BYTES = 20_000_000;
export async function readJobFile(file: string) {
  if ((await stat(file)).size > MAX_BYTES) throw Error("Job exceeds 20 MB");
  return readJob(JSON.parse(await readFile(file, "utf8")));
}
export async function writeJobFile(file: string, value: unknown) {
  const job = jobSchema.parse(value);
  const data = JSON.stringify(job, null, 2);
  if (Buffer.byteLength(data) > MAX_BYTES) throw Error("Job exceeds 20 MB");
  const temp = `${file}.tmp-${randomUUID()}`;
  try {
    await writeFile(temp, data, { encoding: "utf8", flag: "wx" });
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return job;
}

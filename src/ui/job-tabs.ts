import type { Job, JobView } from "../core/job";
import type { Point } from "../core/model";

export interface JobDocument {
  id: string;
  job: Job;
  savedSnapshot: string;
  filePath: string | null;
  history: Job[];
  future: Job[];
  view: JobView;
  mode:
    | "job"
    | "sheets"
    | "part"
    | "nest"
    | "paths"
    | "material"
    | "library"
    | "mcp"
    | "machine";
  zoom: number;
  pan: Point;
  partPanel: "geometry" | "cuts" | "process";
}
export const documentDirty = (doc: JobDocument) =>
  JSON.stringify(doc.job) !== doc.savedSnapshot;
export function newJobDocument(
  id: string,
  job: Job,
  filePath: string | null = null,
): JobDocument {
  return {
    id,
    job,
    filePath,
    savedSnapshot: JSON.stringify(job),
    history: [],
    future: [],
    view: { kind: "sheet", id: job.sheets[0].id },
    mode: "job",
    zoom: 1,
    pan: { x: 0, y: 0 },
    partPanel: "geometry",
  };
}
export function sameJobPath(a: string | null, b: string | null) {
  return (
    !!a &&
    !!b &&
    a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase()
  );
}

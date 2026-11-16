import { id } from "./model";
import { jobSchema, sheetProject, type Job, type Sheet } from "./job";
import { editView } from "./job-ops";
export type PlacementChange = Partial<
  Pick<Sheet["placements"][number], "x" | "y" | "rotation" | "locked">
>;
export function updateSheetPlacement(
  job: Job,
  sheetId: string,
  placementId: string,
  change: PlacementChange,
): Job {
  return jobSchema.parse({
    ...job,
    sheets: job.sheets.map((s) =>
      s.id === sheetId
        ? {
            ...s,
            placements: s.placements.map((p) =>
              p.id === placementId ? { ...p, ...change } : p,
            ),
          }
        : s,
    ),
  });
}
export function removeSheetPlacement(
  job: Job,
  sheetId: string,
  placementId: string,
): Job {
  return {
    ...job,
    sheets: job.sheets.map((s) =>
      s.id === sheetId
        ? { ...s, placements: s.placements.filter((p) => p.id !== placementId) }
        : s,
    ),
  };
}
export function duplicateSheetPlacement(
  job: Job,
  sheetId: string,
  placementId: string,
) {
  const project = sheetProject(job, sheetId),
    part = project.parts.find((p) => p.id === placementId);
  if (!part) throw Error("Select a placed part first");
  const copy = { ...part, id: id(), x: part.x + 8, y: part.y + 8 };
  return {
    job: editView(
      job,
      { kind: "sheet", id: sheetId },
      { ...project, parts: [...project.parts, copy] },
    ),
    placementId: copy.id,
  };
}

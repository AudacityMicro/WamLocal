import records from "./material-presets.json";
import { projectSchema, type Project } from "./model";

export type CutQuality = "coarse" | "medium" | "fine";
export type MaterialPreset = (typeof records)[number];
export const materialPresets: readonly MaterialPreset[] = records;
export const presetSource = "WAM 2.5.0 Pro · captured 2026-11-08";

export function presetIssue(preset: MaterialPreset): string | null {
  if (preset.tabWidth > 20)
    return `Recorded tab width ${preset.tabWidth} mm exceeds the editor limit of 20 mm. Use custom settings.`;
  if (preset.lead > 30)
    return "Recorded lead length exceeds the editor limit of 30 mm. Use custom settings.";
  return null;
}

/** Apply only exact captured Speed Mode values. Kerf and tab count are job settings. */
export function applyMaterialPreset(
  project: Project,
  id: string,
  quality: CutQuality,
): Project {
  const preset = materialPresets.find((p) => p.id === id);
  if (!preset)
    throw Error(
      "Unknown material preset. Only recorded thicknesses are available.",
    );
  if (preset.machine !== project.machine)
    throw Error(
      "This preset requires WAZER Pro. Desktop reference presets are not available.",
    );
  if (!["coarse", "medium", "fine"].includes(quality))
    throw Error("Unknown cut quality.");
  const issue = presetIssue(preset);
  if (issue) throw Error(issue);
  return projectSchema.parse({
    ...project,
    material: {
      ...project.material,
      name: preset.name,
      thickness: preset.thicknessMm,
      feed: preset.feeds[quality],
      pierce: preset.pierce,
      abrasive: preset.abrasive,
      tabWidth: preset.tabWidth,
      lead: preset.lead,
      preset: { id, quality },
    },
  });
}

/** A saved reference badge is valid only while the actual settings still match. */
export function activeMaterialPreset(
  project: Project,
): MaterialPreset | undefined {
  const reference = project.material.preset;
  if (!reference) return;
  const preset = materialPresets.find((p) => p.id === reference.id);
  if (!preset || preset.machine !== project.machine || presetIssue(preset))
    return;
  const m = project.material;
  if (
    m.name === preset.name &&
    m.thickness === preset.thicknessMm &&
    m.feed === preset.feeds[reference.quality] &&
    m.pierce === preset.pierce &&
    m.abrasive === preset.abrasive &&
    m.tabWidth === preset.tabWidth &&
    m.lead === preset.lead
  )
    return preset;
}

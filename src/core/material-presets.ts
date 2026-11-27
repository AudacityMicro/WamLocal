import records from "./material-presets.json";
import { projectSchema, type Project } from "./model";
import { defaultTabWidth } from "./tab-defaults";
import { interpolateMaterialCurve } from "./material-interpolation";

export type CutQuality = "coarse" | "medium" | "fine";
export type MaterialPreset = (typeof records)[number] & {
  requiresProcessReview?: boolean;
  processProxy?: { material: string; thicknessMm: number; clamped: boolean };
};
export const rawMaterialPresets: readonly MaterialPreset[] = records;
const acrylic = records
  .filter((p) => p.machine === "pro" && p.name === "Acrylic - Acrylic")
  .sort((a, b) => a.thicknessMm - b.thicknessMm);
export const materialPresets: readonly MaterialPreset[] = records.map((p) => {
  if (p.machine === "pro" && p.name === "Polyethylene Foam - 4lb")
    return { ...p, requiresProcessReview: true };
  if (p.machine !== "pro" || p.name !== "EPDM - EPDM") return p;
  const thickness = Math.max(
    acrylic[0].thicknessMm,
    Math.min(acrylic.at(-1)!.thicknessMm, p.thicknessMm),
  );
  const donor =
    acrylic.find((a) => Math.abs(a.thicknessMm - thickness) < 1e-7) ??
    interpolateMaterialCurve(acrylic, thickness);
  return {
    ...p,
    feeds: { ...donor.feeds },
    pierce: donor.pierce,
    lead: donor.lead,
    abrasive: donor.abrasive,
    processProxy: {
      material: "Acrylic - Acrylic",
      thicknessMm: thickness,
      clamped: Math.abs(thickness - p.thicknessMm) > 1e-7,
    },
  };
});
export const presetSource = "WAM 2.5.0 Pro · recorded reference values";

export function presetIssue(preset: MaterialPreset): string | null {
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
      tabWidth: defaultTabWidth(preset.thicknessMm),
      tabDefaultWidthMm: defaultTabWidth(preset.thicknessMm),
      lead: preset.lead,
      preset:
        preset.processProxy || preset.requiresProcessReview
          ? undefined
          : { id, quality },
      requiresVerification: !!(
        preset.processProxy || preset.requiresProcessReview
      ),
      source: preset.processProxy
        ? "Acrylic process proxy for EPDM; review before cutting"
        : project.material.source,
      quality,
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
  if (
    !preset ||
    preset.processProxy ||
    preset.requiresProcessReview ||
    preset.machine !== project.machine ||
    presetIssue(preset)
  )
    return;
  const m = project.material;
  if (
    m.name === preset.name &&
    m.thickness === preset.thicknessMm &&
    m.feed === preset.feeds[reference.quality] &&
    m.pierce === preset.pierce &&
    m.abrasive === preset.abrasive &&
    m.tabWidth === defaultTabWidth(preset.thicknessMm) &&
    m.lead === preset.lead
  )
    return preset;
}

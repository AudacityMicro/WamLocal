import {
  defaultMaterial,
  materialLibrarySchema,
  type MaterialLibrary,
} from "./job";
import {
  materialPresets,
  presetIssue,
  applyMaterialPreset,
} from "./material-presets";
import { newProject } from "./model";
export function initialMaterialLibrary(): MaterialLibrary {
  const materials = [defaultMaterial("desktop"), defaultMaterial("pro")];
  materials[0].id = "custom-desktop";
  materials[1].id = "custom-pro";
  for (const p of materialPresets.filter(
    (p) => p.thicknessIn === 0.125 && !presetIssue(p),
  ))
    for (const quality of ["coarse", "medium", "fine"] as const) {
      const settings = applyMaterialPreset(
        { ...newProject(), machine: "pro" },
        p.id,
        quality,
      ).material;
      materials.push({
        ...settings,
        id: `${p.id}-${quality}`,
        machine: "pro",
        name: `${p.name} · ${quality}`,
        stockKey: p.name,
        pierceDiameter: 0,
        source:
          "WAM 2.5.0 Speed Mode feed/pierce capture; kerf and pierce diameter are user inputs",
      });
    }
  return materialLibrarySchema.parse({ version: 1, materials });
}

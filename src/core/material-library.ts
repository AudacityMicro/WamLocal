import { defaultMachineSettings } from "./machine-settings";
import {
  defaultMaterial,
  materialLibrarySchema,
  type JobMaterial,
  type MaterialLibrary,
} from "./job";
import { materialPresets, presetIssue } from "./material-presets";
import { extendGaugeLibrary } from "./material-gauges";
import {
  materialName,
  materialQuality,
  thicknessKey,
} from "./material-selection";

export const CUT_QUALITIES = ["coarse", "medium", "fine"] as const;
const referenceSource =
  "WAM 2.5.0 Pro Speed Mode capture; unset pierce diameter follows machine kerf";

/** Expand exact reference captures and quality choices without changing saved edits. */
export function extendMaterialLibrary(
  library: MaterialLibrary,
): MaterialLibrary {
  const capturedKeys = new Set(
    materialPresets.flatMap((p) =>
      CUT_QUALITIES.map(
        (quality) => `pro|${p.name}|${thicknessKey(p.thicknessMm)}|${quality}`,
      ),
    ),
  );
  const materials = library.materials
    .filter(
      (m) =>
        !(
          m.id.startsWith("quality-pro-") &&
          m.source?.startsWith("No exact WAM") &&
          capturedKeys.has(profileKey(m))
        ),
    )
    .map((m) => ({ ...m }));
  const ids = new Set(materials.map((m) => m.id));
  const add = (m: JobMaterial) => {
    if (!ids.has(m.id)) {
      materials.push(m);
      ids.add(m.id);
    }
  };
  for (const p of materialPresets) {
    const issue = presetIssue(p);
    for (const quality of CUT_QUALITIES) {
      const base = defaultMaterial("pro");
      add({
        ...base,
        id: `${p.id}-${quality}`,
        machine: "pro",
        name: `${p.name} · ${quality}`,
        stockKey: p.name,
        quality,
        thickness: p.thicknessMm,
        feed: p.feeds[quality],
        pierce: p.pierce,
        abrasive: p.abrasive,
        tabWidth: p.tabWidth <= 20 ? p.tabWidth : base.tabWidth,
        lead: p.lead <= 30 ? p.lead : base.lead,
        kerf: library.machines?.pro.kerf ?? defaultMachineSettings("pro").kerf,
        pierceDiameter: 0,
        preset: issue ? undefined : { id: p.id, quality },
        requiresVerification: !!issue,
        source: issue
          ? `${referenceSource}. ${issue} Feed, pierce and abrasive values are captured; the invalid tab/lead default is replaced by the application default and must be verified.`
          : referenceSource,
      });
    }
  }
  const expanded = extendGaugeLibrary({ ...library, materials });
  const result = [...expanded.materials];
  const groups = new Map<string, JobMaterial>();
  for (const m of result)
    groups.set(`${materialName(m)}|${thicknessKey(m.thickness)}`, m);
  const available = new Set(result.map(profileKey));
  const allIds = new Set(result.map((m) => m.id));
  for (const base of groups.values())
    for (const machine of ["desktop", "pro"] as const)
      for (const quality of CUT_QUALITIES) {
        const stock = materialName(base);
        const key = `${machine}|${stock}|${thicknessKey(base.thickness)}|${quality}`;
        if (available.has(key)) continue;
        const prefix = `quality-${machine}-${encodeURIComponent(stock)}-${thicknessKey(base.thickness)}-${quality}`;
        let id = prefix;
        for (let n = 2; allIds.has(id); n++) id = `${prefix}-${n}`;
        result.push({
          ...defaultMaterial(machine),
          id,
          name: `${stock} · ${quality}`,
          stockKey: stock,
          machine,
          quality,
          thickness: base.thickness,
          kerf:
            expanded.machines?.[machine].kerf ??
            defaultMachineSettings(machine).kerf,
          requiresVerification: true,
          preset: undefined,
          source: `No exact WAM ${machine} capture for ${stock} at ${base.thickness} mm (${quality}). Generic application defaults only; enter and verify cutting settings.`,
        });
        available.add(key);
        allIds.add(id);
      }
  return materialLibrarySchema.parse({ ...expanded, materials: result });
}
function profileKey(m: JobMaterial) {
  return `${m.machine}|${materialName(m)}|${thicknessKey(m.thickness)}|${materialQuality(m)}`;
}

export function initialMaterialLibrary(): MaterialLibrary {
  const materials = [defaultMaterial("desktop"), defaultMaterial("pro")];
  materials[0].id = "custom-desktop";
  materials[1].id = "custom-pro";
  return extendMaterialLibrary({
    version: 1,
    materials,
    machines: {
      desktop: defaultMachineSettings("desktop"),
      pro: defaultMachineSettings("pro"),
    },
  });
}

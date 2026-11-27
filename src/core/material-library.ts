import {
  defaultMachineSettings,
  withDefaultMachineCosts,
} from "./machine-settings";
import {
  defaultMaterial,
  materialLibrarySchema,
  type JobMaterial,
  type MaterialLibrary,
} from "./job";
import { materialPresets, presetIssue } from "./material-presets";
import { extendGaugeLibrary } from "./material-gauges";
import { feedCaptures } from "./material-feed-corrections";
import {
  outsideReferenceCatalog,
  referenceThicknessLimit,
} from "./material-coverage";
import { estimateMaterialSettings } from "./material-estimate";
import { defaultImportSettings } from "./import-settings";
import { defaultTabWidth } from "./tab-defaults";
import { repairMaterialProfiles } from "./material-profile-repairs";
import {
  materialName,
  materialQuality,
  thicknessKey,
  isDemoFeedProfile,
} from "./material-selection";

export const CUT_QUALITIES = ["coarse", "medium", "fine"] as const;
const capturesByStock = new Map<string, (typeof feedCaptures)[number][]>();
for (const capture of feedCaptures) {
  const key = `${capture.machine}|${capture.name}`,
    group = capturesByStock.get(key);
  if (group) group.push(capture);
  else capturesByStock.set(key, [capture]);
}
export function deleteMaterialPreset(
  library: MaterialLibrary,
  materialId: string,
): MaterialLibrary {
  return materialLibrarySchema.parse({
    ...library,
    materials: library.materials.filter((m) => m.id !== materialId),
    deletedMaterialIds: [
      ...new Set([...(library.deletedMaterialIds ?? []), materialId]),
    ],
  });
}

export function saveMaterialPreset(
  library: MaterialLibrary,
  material: JobMaterial,
): MaterialLibrary {
  return materialLibrarySchema.parse({
    ...library,
    materials: [
      ...library.materials.filter((m) => m.id !== material.id),
      structuredClone(material),
    ],
    deletedMaterialIds: library.deletedMaterialIds?.filter(
      (id) => id !== material.id,
    ),
  });
}
const referenceSource =
  "WAM 2.5.0 Pro Speed Mode capture; application thickness-based tab defaults; unset pierce diameter follows machine kerf";

function feedProfile(
  base: JobMaterial,
  capture: (typeof feedCaptures)[number],
  quality: (typeof CUT_QUALITIES)[number],
): JobMaterial {
  if (base.machine === "pro" && materialName(base) === "EPDM - EPDM")
    return estimateMaterialSettings(base, capture.thicknessMm, quality);
  let other = base;
  if (capture.machine === "pro")
    try {
      other = estimateMaterialSettings(base, capture.thicknessMm, quality);
    } catch {
      /* Sparse full-process references remain explicit placeholders. */
    }
  return {
    ...other,
    id: base.id,
    feed: capture.feeds[quality],
    preset: undefined,
    requiresVerification: true,
    source: `WAM ${capture.machine === "pro" ? "Pro" : "Desktop"} demo feed capture 2026-11-17. Nominal feed is recorded. ${other === base ? "Pierce/lead values are application defaults pending review; abrasive follows the machine setting." : other.source}`,
  };
}

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
  const materials: JobMaterial[] = library.materials
    .filter(
      (m) =>
        !(
          m.id.startsWith("quality-pro-") &&
          m.source?.startsWith("No exact WAM") &&
          capturedKeys.has(profileKey(m))
        ),
    )
    .map((m) => ({
      ...m,
      abrasive:
        m.abrasive ??
        library.machines?.[m.machine].abrasive ??
        defaultMachineSettings(m.machine).abrasive,
    }));
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
        tabWidth: defaultTabWidth(p.thicknessMm),
        tabDefaultWidthMm: defaultTabWidth(p.thicknessMm),
        lead: p.lead <= 30 ? p.lead : base.lead,
        kerf: library.machines?.pro.kerf ?? defaultMachineSettings("pro").kerf,
        pierceDiameter: 0,
        preset: issue || p.processProxy ? undefined : { id: p.id, quality },
        requiresVerification: !!issue || !!p.processProxy,
        source: p.processProxy
          ? "Acrylic process proxy for Pro EPDM; review material substitution before cutting"
          : issue
            ? `${referenceSource}. ${issue} Feed, pierce and abrasive values are captured; the invalid tab/lead default is replaced by the application default and must be verified.`
            : referenceSource,
      });
    }
  }
  const expanded = extendGaugeLibrary({ ...library, materials });
  const result = expanded.materials.map((m) => {
    const quality = materialQuality(m);
    const name = materialName(m);
    const capture = capturesByStock
      .get(`${m.machine}|${name}`)
      ?.find((c) => Math.abs(c.thicknessMm - m.thickness) < 1e-7);
    const generated =
      m.source?.startsWith("No exact WAM") ||
      m.source?.startsWith("Nominal sheet gauge") ||
      isDemoFeedProfile(m);
    if (
      !capture ||
      quality === "custom" ||
      !m.requiresVerification ||
      !generated
    )
      return m;
    return feedProfile(m, capture, quality);
  });
  const feedIds = new Set(result.map((m) => m.id));
  const feedKeys = new Set(
    result
      .filter(
        (m) => isDemoFeedProfile(m) || (!m.requiresVerification && !!m.preset),
      )
      .map(profileKey),
  );
  for (const capture of feedCaptures)
    for (const quality of CUT_QUALITIES) {
      const machine = capture.machine as "desktop" | "pro";
      const key = `${machine}|${capture.name}|${thicknessKey(capture.thicknessMm)}|${quality}`;
      if (feedKeys.has(key)) continue;
      const recordId = `${machine}-feed-${encodeURIComponent(capture.name)}-${thicknessKey(capture.thicknessMm)}-${quality}`;
      if (feedIds.has(recordId)) continue; // Preserve a user-edited captured record.
      result.push(
        feedProfile(
          {
            ...defaultMaterial(machine),
            id: recordId,
            machine,
            name: `${capture.name} · ${quality}`,
            stockKey: capture.name,
            quality,
            thickness: capture.thicknessMm,
          },
          capture,
          quality,
        ),
      );
      feedKeys.add(key);
      feedIds.add(recordId);
    }
  // New machine-specific alloys must be gauged in this same expansion so a
  // second load does not unexpectedly append another batch of placeholders.
  const gauged = extendGaugeLibrary({ ...expanded, materials: result });
  for (const m of gauged.materials)
    if (!feedIds.has(m.id)) {
      result.push(m);
      feedIds.add(m.id);
    }
  const groups = new Map<string, JobMaterial>();
  for (const m of result)
    groups.set(`${materialName(m)}|${thicknessKey(m.thickness)}`, m);
  const available = new Set(result.map(profileKey));
  const allIds = new Set(result.map((m) => m.id));
  for (const base of groups.values())
    for (const machine of ["desktop", "pro"] as const)
      for (const quality of CUT_QUALITIES) {
        const stock = materialName(base);
        if (
          stock !== "Custom material" &&
          referenceThicknessLimit(machine, stock) === undefined
        )
          continue;
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
  // Update generated defaults, preserving edited widths and embedded job snapshots.
  const originals = new Map(library.materials.map((m) => [m.id, m]));
  const tabCaptures = new Map(
    materialPresets.map((p) => [`${p.name}|${thicknessKey(p.thicknessMm)}`, p]),
  );
  for (const m of result) {
    const old = originals.get(m.id);
    const captured = tabCaptures.get(
      `${materialName(m)}|${thicknessKey(m.thickness)}`,
    );
    const generated = /WAM|No exact WAM|Nominal sheet gauge|User defaults/.test(
      m.source ?? "",
    );
    const inheritedDefault =
      old &&
      (old.tabWidth === 2 ||
        old.tabWidth === defaultTabWidth(3) ||
        (captured && old.tabWidth === captured.tabWidth));
    const automatic =
      !old ||
      (old.tabDefaultWidthMm !== undefined
        ? Math.abs(old.tabWidth - old.tabDefaultWidthMm) < 1e-7
        : generated && inheritedDefault);
    if (automatic) {
      m.tabWidth = defaultTabWidth(m.thickness);
      m.tabDefaultWidthMm = m.tabWidth;
    }
  }
  const deleted = new Set(library.deletedMaterialIds ?? []);
  return materialLibrarySchema.parse({
    ...expanded,
    machines: {
      desktop: withDefaultMachineCosts("desktop", library.machines?.desktop),
      pro: withDefaultMachineCosts("pro", library.machines?.pro),
    },
    importSettings: library.importSettings ?? defaultImportSettings(),
    materials: repairMaterialProfiles(
      result.filter((m) => {
        if (deleted.has(m.id)) return false;
        const generated =
          m.requiresVerification &&
          (m.source?.startsWith("No exact WAM") ||
            m.source?.startsWith("Nominal sheet gauge"));
        return (
          !generated ||
          !outsideReferenceCatalog(m.machine, materialName(m), m.thickness)
        );
      }),
    ),
  });
}
function profileKey(m: JobMaterial) {
  return `${m.machine}|${materialName(m)}|${thicknessKey(m.thickness)}|${materialQuality(m)}`;
}

/** Small bootstrap used while the desktop loads its authoritative database. */
export function materialLibrarySeed(): MaterialLibrary {
  const materials = [defaultMaterial("desktop"), defaultMaterial("pro")];
  materials[0].id = "custom-desktop";
  materials[1].id = "custom-pro";
  return {
    version: 1,
    materials,
    machines: {
      desktop: defaultMachineSettings("desktop"),
      pro: defaultMachineSettings("pro"),
    },
  };
}
export function initialMaterialLibrary(): MaterialLibrary {
  return extendMaterialLibrary(materialLibrarySeed());
}

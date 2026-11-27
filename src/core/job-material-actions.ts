import {materialQuality} from "./material-selection";
import {
  jobMaterialSchema,
  materialLibrarySchema,
  materialsCompatible,
  type Job,
  type JobMaterial,
  type MaterialLibrary,
} from "./job";
import { setJobMaterial } from "./job-ops";
/** A job-line edit updates shared presets and this job; other saved jobs keep snapshots. */
export function saveJobMaterialProfiles(
  library: MaterialLibrary,
  job: Job,
  profiles: JobMaterial[],
  selectedId: string,
) {
  const current = job.materials.find((m) => m.id === job.sheets[0].materialId)!;
  const materials = profiles.map((m) => {
    if (m.machine !== job.machine)
      throw Error("Material must use the job's machine.");
    const old = library.materials.find((p) => p.id === m.id),
      defaults = { ...m.settingDefaults };
    if (old && old.machine !== m.machine)
      throw Error("Cannot overwrite another machine's material profile.");
    for (const key of [
      "feed",
      "pierce",
      "lead",
      "kerf",
      "abrasive",
      "pierceDiameter",
      "tabWidth",
      "tabCount",
    ] as const)
      if (Object.hasOwn(defaults, `process.${key}`))
        defaults[`process.${key}`] = m[key] ?? null;
    if (old && m.tabWidth !== old.tabWidth) {
      defaults["tabs.width"] = m.tabWidth;
      defaults["tabs.automaticWidth"] = false;
    }
    if (old && m.tabCount !== old.tabCount) defaults["tabs.count"] = m.tabCount;
    return jobMaterialSchema.parse({
      ...m,
      settingDefaults: Object.keys(defaults).length ? defaults : undefined,
      preset: undefined,
      source: "User-edited defaults",
    });
  });
  const selected = materials.find((m) => m.id === selectedId);
  if (!selected) throw Error("Select a material profile.");
  const changed = new Set(materials.map((m) => m.id));
  const nextLibrary = materialLibrarySchema.parse({
    ...library,
    materials: [
      ...library.materials.filter((m) => !changed.has(m.id)),
      ...materials,
    ],
    deletedMaterialIds: library.deletedMaterialIds?.filter(
      (id) => !changed.has(id),
    ),
  });
  let nextJob = setJobMaterial(job, selected);
  if (nextJob.tabRules) {
    nextJob = {
      ...nextJob,
      tabRules: {
        ...(materialsCompatible(current,selected)&&materialQuality(current)===materialQuality(selected)?job.tabRules??nextJob.tabRules:nextJob.tabRules),
        ...(selected.tabWidth !== current.tabWidth
          ? { width: selected.tabWidth, automaticWidth: false }
          : {}),
        ...(selected.tabCount !== current.tabCount
          ? { count: selected.tabCount }
          : {}),
      },
    };
  }
  return { library: nextLibrary, job: nextJob };
}

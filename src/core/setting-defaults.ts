import {
  materialLibrarySchema,
  jobMaterialSchema,
  jobSchema,
  type Job,
  type JobMaterial,
  type MaterialLibrary,
} from "./job";
import {
  materialName,
  materialQuality,
  thicknessKey,
} from "./material-selection";
import { defaultTabWidth } from "./tab-defaults";
import { searchSettings } from "./nesting-search";
import { partSchema, contourSchema, type Part, type Contour } from "./model";

export type SettingValue = number | string | boolean | null;
export function newContourDefaults(
  contour: Contour,
  material: JobMaterial,
): Contour {
  const d = material.settingDefaults ?? {},
    result = { ...contour };
  for (const key of [
    "lead",
    "leadInOverlap",
    "leadOutOverlap",
    "cut",
    "tabMode",
  ] as const)
    if (result[key] === undefined && d[`contour.${key}`] != null)
      (result as any)[key] = d[`contour.${key}`];
  return contourSchema.parse(result);
}
export function newPartDefaults(part: Part, material: JobMaterial): Part {
  const d = material.settingDefaults ?? {};
  return partSchema.parse({
    ...part,
    stockToLeave: d.stockToLeave ?? part.stockToLeave,
    cut: part.contours.some((c) => !c.closed) ? part.cut : (d.cut ?? part.cut),
    rotationPolicy: d.rotationPolicy ?? part.rotationPolicy,
    contours: part.contours.map((c) => newContourDefaults(c, material)),
  });
}
export function matchingDefaultMaterial(
  library: MaterialLibrary,
  current: JobMaterial,
) {
  const same = (m: JobMaterial) =>
    m.machine === current.machine &&
    materialName(m) === materialName(current) &&
    thicknessKey(m.thickness) === thicknessKey(current.thickness) &&
    materialQuality(m) === materialQuality(current);
  return (
    library.materials.find((m) => m.id === current.id && same(m)) ??
    library.materials.find(same)
  );
}
const processKeys = new Set([
  "feed",
  "pierce",
  "pierceDiameter",
  "lead",
  "leadInOverlap",
  "leadOutOverlap",
  "tabWidth",
  "tabCount",
  "kerf",
  "abrasive",
  "leadStyle",
  "cornerSlowdown",
]);
function canonicalKey(key: string) {
  if (key === "process.tabWidth" || key === "tabWidth") return "tabs.width";
  if (key === "process.tabCount" || key === "tabCount") return "tabs.count";
  return processKeys.has(key) ? `process.${key}` : key;
}
export function saveSettingDefault(
  library: MaterialLibrary,
  key: string,
  value: SettingValue,
  material?: JobMaterial,
): MaterialLibrary {
  if (material) key = canonicalKey(key);
  if (!material)
    return materialLibrarySchema.parse({
      ...library,
      settingDefaults: { ...library.settingDefaults, [key]: value },
    });
  const record = matchingDefaultMaterial(library, material) ?? {
    ...material,
    id: `defaults-${material.machine}-${encodeURIComponent(materialName(material))}-${thicknessKey(material.thickness)}-${materialQuality(material)}`,
  };
  const field = key.startsWith("process.")
    ? key.slice(8)
    : key === "tabs.width"
      ? "tabWidth"
      : key === "tabs.count"
        ? "tabCount"
        : undefined;
  const settings = {
    ...record.settingDefaults,
    [key]: value,
    ...(key === "tabs.width" ? { "tabs.automaticWidth": false } : {}),
  };
  const updated = jobMaterialSchema.parse({
    ...record,
    settingDefaults: settings,
    ...(field && processKeys.has(field)
      ? { [field]: value === null ? undefined : value }
      : {}),
    source: `User-edited defaults; ${record.source ?? "local material"}`,
  });
  return materialLibrarySchema.parse({
    ...library,
    materials: [
      ...library.materials.filter((m) => m.id !== updated.id),
      updated,
    ],
    deletedMaterialIds: library.deletedMaterialIds?.filter(
      (id) => id !== updated.id,
    ),
  });
}
export function resolveSettingDefault(
  library: MaterialLibrary,
  key: string,
  fallback: SettingValue,
  material?: JobMaterial,
): SettingValue {
  if (material) key = canonicalKey(key);
  const record = material
    ? matchingDefaultMaterial(library, material)
    : undefined;
  const saved = material ? record?.settingDefaults : library.settingDefaults;
  if (key === "tabs.width" && saved?.["tabs.automaticWidth"] === true && record)
    return defaultTabWidth(record.thickness);
  if (saved && Object.hasOwn(saved, key)) return saved[key];
  if (record && key.startsWith("process."))
    return (record as any)[key.slice(8)] ?? fallback;
  if (record && key === "tabs.width") return record.tabWidth;
  if (record && key === "tabs.count") return record.tabCount;
  return fallback;
}
export function materialTabDefaults(material: JobMaterial) {
  const d = material.settingDefaults ?? {};
  return {
    width:
      d["tabs.automaticWidth"] === true
        ? defaultTabWidth(material.thickness)
        : Number(
            d["tabs.width"] ??
              material.tabWidth ??
              defaultTabWidth(material.thickness),
          ),
    count: Number(d["tabs.count"] ?? material.tabCount),
    automaticWidth:
      d["tabs.automaticWidth"] === undefined
        ? material.tabDefaultWidthMm === material.tabWidth
        : Boolean(d["tabs.automaticWidth"]),
    minHoleArea: Number(d["tabs.minHoleArea"] ?? 0),
    maxPartArea:
      d["tabs.maxPartArea"] == null ? undefined : Number(d["tabs.maxPartArea"]),
  };
}
/** Factory job stock; explicit saved defaults still take precedence. */
export function defaultJobMaterial(
  library: MaterialLibrary,
  machine: Job["machine"],
  thickness = 3,
) {
  return library.materials
    .filter(
      (m) =>
        m.machine === machine &&
        materialName(m) === "Aluminum - 6061" &&
        materialQuality(m) === "medium",
    )
    .sort(
      (a, b) =>
        Math.abs(a.thickness - thickness) - Math.abs(b.thickness - thickness),
    )[0];
}
export function applyNewJobDefaults(job: Job, library: MaterialLibrary): Job {
  const d = library.settingDefaults ?? {},
    stock = { ...job.sheets[0].stock };
  for (const k of ["width", "height", "margin", "spacing"] as const)
    if (typeof d[`stock.${k}`] === "number")
      stock[k] = d[`stock.${k}`] as number;
  const nesting = { ...searchSettings(job.nesting) };
  for (const [k, v] of Object.entries(d))
    if (k.startsWith("nesting.")) (nesting as any)[k.slice(8)] = v;
  const selected =
    library.materials.find(
      (m) =>
        m.id === d[`job.materialId.${job.machine}`] &&
        m.machine === job.machine,
    ) ?? defaultJobMaterial(library, job.machine, job.materials[0].thickness);
  return jobSchema.parse({
    ...job,
    ...(job.nameMode === undefined && job.name === "Untitled job"
      ? { nameMode: "auto", nameUnits: library.displayUnits ?? "mm" }
      : {}),
    nesting,
    materials: selected ? [selected] : job.materials,
    tabRules: selected ? materialTabDefaults(selected) : job.tabRules,
    sheets: job.sheets.map((s) => ({
      ...s,
      materialId: selected?.id ?? s.materialId,
      stock: { ...s.stock, ...stock },
      workOrigin: (d["job.workOrigin"] ?? s.workOrigin) as typeof s.workOrigin,
      workOriginReference: (d["job.workOriginReference"] ??
        s.workOriginReference) as typeof s.workOriginReference,
    })),
  });
}

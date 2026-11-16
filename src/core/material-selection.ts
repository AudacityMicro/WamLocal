import type { JobMaterial } from "./job";
import { gaugesFor } from "./material-gauges";
export type CutQuality = "coarse" | "medium" | "fine" | "custom";
export function materialName(m: JobMaterial) {
  return (
    m.stockKey ?? m.name.replace(/\s*[\u00b7-]\s*(coarse|medium|fine)$/i, "")
  );
}
export function materialQuality(m: JobMaterial): CutQuality {
  return (
    m.quality ??
    m.preset?.quality ??
    (m.name
      .match(/[\u00b7-]\s*(coarse|medium|fine)$/i)?.[1]
      .toLowerCase() as CutQuality) ??
    "custom"
  );
}
export const thicknessKey = (n: number) => n.toFixed(7);
export function thicknessLabel(m: JobMaterial, units: "mm" | "in" = "mm") {
  const g = gaugesFor(materialName(m)).find(
    (g) => Math.abs(g.mm - m.thickness) < 0.00001,
  );
  return `${g ? g.gauge + " Ga - " : ""}${Number((units === "in" ? m.thickness / 25.4 : m.thickness).toFixed(units === "in" ? 5 : 4))} ${units}`;
}
export const qualityLabel = (m: JobMaterial) =>
  ({ coarse: "Coarse", medium: "Medium", fine: "Fine", custom: "Custom" })[
    materialQuality(m)
  ];
export function materialCatalog(records: JobMaterial[], current: JobMaterial) {
  const seen = new Set<string>();
  return [current, ...records].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}
export function qualityProfiles(
  records: JobMaterial[],
  current: JobMaterial,
  machine: JobMaterial["machine"],
  allMachines = false,
) {
  const group = materialCatalog(records, current).filter(
    (m) =>
      materialName(m) === materialName(current) &&
      thicknessKey(m.thickness) === thicknessKey(current.thickness) &&
      (allMachines || m.machine === machine),
  );
  const names = (m: JobMaterial) =>
    materialName({ ...m, stockKey: undefined }) === materialName(m)
      ? ""
      : m.name;
  const ordered = [...group].sort(
    (a, b) =>
      (a.id === current.id ? -10 : a.machine === machine ? -1 : 0) -
      (b.id === current.id ? -10 : b.machine === machine ? -1 : 0),
  );
  const key = (m: JobMaterial) =>
    [
      materialQuality(m),
      names(m),
      allMachines ? m.machine : "",
      m.requiresVerification ? "pending" : "ready",
    ].join("|");
  return ordered
    .filter((m, i, a) => a.findIndex((x) => key(x) === key(m)) === i)
    .sort(
      (a, b) =>
        ["coarse", "medium", "fine", "custom"].indexOf(materialQuality(a)) -
        ["coarse", "medium", "fine", "custom"].indexOf(materialQuality(b)),
    );
}
export function selectMaterialProfile(
  records: JobMaterial[],
  current: JobMaterial,
  machine: JobMaterial["machine"],
  name: string,
  thickness?: number,
) {
  let candidates = records.filter((m) => materialName(m) === name);
  if (!candidates.length) return current;
  const target = thickness ?? current.thickness;
  const nearest = [...candidates].sort(
    (a, b) => Math.abs(a.thickness - target) - Math.abs(b.thickness - target),
  )[0].thickness;
  candidates = candidates.filter(
    (m) => thicknessKey(m.thickness) === thicknessKey(nearest),
  );
  const quality = materialQuality(current);
  const recordedReplacement = candidates.some(
    (m) =>
      m.machine === machine &&
      materialQuality(m) === quality &&
      !m.requiresVerification,
  );
  return [...candidates].sort((a, b) => {
    const score = (m: JobMaterial) =>
      (m.id === current.id && !(m.requiresVerification && recordedReplacement)
        ? 100
        : 0) +
      (materialQuality(m) === materialQuality(current)
        ? 20
        : materialQuality(m) === "medium"
          ? 10
          : 0) +
      (m.machine === machine ? 50 : 0) +
      (!m.requiresVerification ? 5 : 0);
    return score(b) - score(a);
  })[0];
}

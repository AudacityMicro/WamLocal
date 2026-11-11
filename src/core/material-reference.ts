export type RecordedMaterial = {
  name: string;
  category: string;
  machineType: string;
  thickness: { value: number; unit: string };
  speedMode: ModeRates;
  ecoMode: ModeRates;
  pierceTime: UnitValue;
  defaultTabWidth: UnitValue;
  defaultLeadDist: UnitValue;
  maxThicknessMM: number;
  maxTab: number;
};
type UnitValue = { value: number; unit: string };
type ModeRates = {
  roughRate: UnitValue;
  mediumRate: UnitValue;
  fineRate: UnitValue;
  abrasiveRate: UnitValue;
};
export type MaterialCapture = {
  materialIndex: number;
  name: string;
  category: string;
  thicknessIn: number;
  thicknessMm: number;
  data: RecordedMaterial;
};
export const materialParameterPaths = [
  "speedMode.roughRate",
  "speedMode.mediumRate",
  "speedMode.fineRate",
  "speedMode.abrasiveRate",
  "ecoMode.roughRate",
  "ecoMode.mediumRate",
  "ecoMode.fineRate",
  "ecoMode.abrasiveRate",
  "pierceTime",
  "defaultTabWidth",
  "defaultLeadDist",
] as const;
export function materialParameter(
  data: RecordedMaterial,
  path: (typeof materialParameterPaths)[number],
): number {
  const [group, key] = path.split(".");
  return key
    ? (
        data[group as "speedMode" | "ecoMode"][
          key as keyof ModeRates
        ] as UnitValue
      ).value
    : (
        data[
          group as "pierceTime" | "defaultTabWidth" | "defaultLeadDist"
        ] as UnitValue
      ).value;
}
/** Exact recorded results only. Do not interpolate uncaptured WAM settings. */
export function lookupRecordedMaterial(
  captures: MaterialCapture[],
  machine: "pro" | "desktop",
  name: string,
  thicknessIn: number,
): RecordedMaterial {
  if (!Number.isFinite(thicknessIn) || thicknessIn <= 0)
    throw Error("Thickness must be positive and finite.");
  const match = captures.find(
    (c) =>
      c.data.machineType === machine &&
      c.name === name &&
      Math.abs(c.thicknessIn - thicknessIn) <= 1e-10,
  );
  if (!match)
    throw Error(
      "No exact WAM capture exists for this machine, material and thickness. Capture or import its settings; interpolation is unverified.",
    );
  return structuredClone(match.data);
}

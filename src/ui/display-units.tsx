import { NumericInput } from "./NumericInput";
import { createContext, useContext } from "react";
export type DisplayUnits = "mm" | "in";
export function unitFormat(unit: DisplayUnits) {
  const scale = unit === "in" ? 25.4 : 1;
  return {
    unit,
    areaUnit: unit === "in" ? "in²" : "mm²",
    toDisplayArea: (mm2: number) => mm2 / (scale * scale),
    toMM2: (n: number) => n * scale * scale,
    toDisplay: (mm: number) => mm / scale,
    toMM: (n: number) => n * scale,
    number: (mm: number, digits = 4) =>
      Number((mm / scale).toFixed(digits)).toString(),
    length: (mm: number) => `${Number((mm / scale).toFixed(4))} ${unit}`,
  };
}
export const DisplayUnitsContext = createContext(unitFormat("mm"));
export const useDisplayUnits = () => useContext(DisplayUnitsContext);
export function AreaInput({
  value,
  onChange,
  ...props
}: {
  value: number;
  onChange: (mm2: number) => void;
  [key: string]: unknown;
}) {
  const u = useDisplayUnits();
  return (
    <NumericInput
      {...props}
      key={u.unit}
      unit={`${u.unit}^2`}
      min={0}
      max={u.toDisplayArea(1e10)}
      value={Number(u.toDisplayArea(value).toFixed(6))}
      onChange={(n) => onChange(u.toMM2(n))}
    />
  );
}
export function LengthInput({
  value,
  onChange,
  min,
  max,
  step = 0.1,
  rate = false,
  ...props
}: {
  value: number;
  onChange: (mm: number) => void;
  min?: number;
  max?: number;
  step?: number;
  rate?: boolean;
  [key: string]: unknown;
}) {
  const u = useDisplayUnits();
  return (
    <NumericInput
      {...props}
      key={u.unit}
      unit={rate ? `${u.unit}/min` : u.unit}
      value={Number(u.toDisplay(value).toFixed(5))}
      min={min === undefined ? undefined : u.toDisplay(min)}
      max={max === undefined ? undefined : u.toDisplay(max)}
      step={u.toDisplay(step)}
      onChange={(n) => onChange(u.toMM(n))}
    />
  );
}

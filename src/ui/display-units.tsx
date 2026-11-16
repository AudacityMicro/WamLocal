import { createContext, useContext } from "react";
export type DisplayUnits = "mm" | "in";
export function unitFormat(unit: DisplayUnits) {
  const scale = unit === "in" ? 25.4 : 1;
  return {
    unit,
    toDisplay: (mm: number) => mm / scale,
    toMM: (n: number) => n * scale,
    number: (mm: number, digits = 4) =>
      Number((mm / scale).toFixed(digits)).toString(),
    length: (mm: number) => `${Number((mm / scale).toFixed(4))} ${unit}`,
  };
}
export const DisplayUnitsContext = createContext(unitFormat("mm"));
export const useDisplayUnits = () => useContext(DisplayUnitsContext);
export function LengthInput({
  value,
  onChange,
  min,
  max,
  step = 0.1,
  ...props
}: {
  value: number;
  onChange: (mm: number) => void;
  min?: number;
  max?: number;
  step?: number;
  [key: string]: unknown;
}) {
  const u = useDisplayUnits();
  return (
    <input
      {...props}
      type="number"
      value={Number(u.toDisplay(value).toFixed(5))}
      min={min === undefined ? undefined : u.toDisplay(min)}
      max={max === undefined ? undefined : u.toDisplay(max)}
      step={u.toDisplay(step)}
      onChange={(e) => {
        const n = u.toMM(e.target.valueAsNumber);
        if (
          Number.isFinite(n) &&
          (min === undefined || n >= min - 1e-9) &&
          (max === undefined || n <= max + 1e-9)
        )
          onChange(n);
      }}
    />
  );
}

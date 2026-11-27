import { canonicalStockName } from "./stock-name";
export function jobDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function automaticJobName(
  material: { name: string; stockKey?: string; thickness: number },
  date: string,
  units: "mm" | "in" = "mm",
) {
  const name = canonicalStockName(
    material.stockKey ??
      material.name.replace(/\s*[·-]\s*(coarse|medium|fine)$/i, ""),
  ).replace(/\s+-\s+/g, " ");
  const thickness = Number(
    (material.thickness / (units === "in" ? 25.4 : 1)).toFixed(
      units === "in" ? 5 : 4,
    ),
  );
  return `${date} · ${name} · ${thickness} ${units}`;
}

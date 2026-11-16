import type { JobMaterial, MaterialLibrary } from "./job";
import { defaultMaterial } from "./job";
export const GAUGE_SOURCE =
  "https://assets.mcnichols.com/content/dam/mcnichols/resources/PDF/DPM-GA-WGTS-PRIMARY-MATL.pdf";
export type GaugeFamily = "steel" | "stainless" | "aluminum";
const sizes = {
  steel: {
    7: 0.1793,
    8: 0.1644,
    9: 0.1495,
    10: 0.1345,
    11: 0.1196,
    12: 0.1046,
    13: 0.0897,
    14: 0.0747,
    15: 0.0673,
    16: 0.0598,
    17: 0.0538,
    18: 0.0478,
    19: 0.0418,
    20: 0.0359,
    21: 0.0329,
    22: 0.0299,
    23: 0.0269,
    24: 0.0239,
    25: 0.0209,
    26: 0.0179,
  },
  stainless: {
    7: 0.1875,
    8: 0.1719,
    9: 0.1562,
    10: 0.1406,
    11: 0.125,
    12: 0.1094,
    13: 0.0937,
    14: 0.0781,
    15: 0.0703,
    16: 0.0625,
    17: 0.0562,
    18: 0.05,
    19: 0.0437,
    20: 0.0375,
    21: 0.0344,
    22: 0.0312,
    23: 0.0281,
    24: 0.025,
    25: 0.0219,
    26: 0.0187,
  },
  // Nominal aluminum sheet stock, as listed in GAUGE_SOURCE. Do not use
  // the precise B&S wire/brass values for these supplier sheet presets.
  aluminum: {
    7: 0.14,
    8: 0.125,
    9: 0.112,
    10: 0.1,
    11: 0.09,
    12: 0.08,
    13: 0.071,
    14: 0.063,
    15: 0.056,
    16: 0.05,
    17: 0.045,
    18: 0.04,
    19: 0.036,
    20: 0.032,
    21: 0.028,
    22: 0.025,
    23: 0.022,
    24: 0.02,
    25: 0.018,
    26: 0.016,
  },
};
export function gaugeFamily(name: string): GaugeFamily | undefined {
  return /stainless/i.test(name)
    ? "stainless"
    : /alumin/i.test(name)
      ? "aluminum"
      : /steel/i.test(name)
        ? "steel"
        : undefined;
}
export function gaugesFor(name: string) {
  const family = gaugeFamily(name);
  return family
    ? Object.entries(sizes[family]).map(([g, v]) => ({
        gauge: Number(g),
        mm: v * 25.4,
        inches: v,
      }))
    : [];
}
export function materialLabel(m: JobMaterial) {
  const gauge = gaugesFor(m.stockKey ?? m.name).find(
    (g) => Math.abs(g.mm - m.thickness) < 0.00001,
  );
  return `${m.name} · ${gauge ? gauge.gauge + " Ga · " : ""}${Number(m.thickness.toFixed(4))} mm`;
}
export function extendGaugeLibrary(library: MaterialLibrary): MaterialLibrary {
  library = {
    ...library,
    materials: library.materials
      .map((m) =>
        m.source ===
          "WAM 2.5.0 Speed Mode feed/pierce capture; kerf and pierce diameter are user inputs" &&
        m.kerf === 1.1
          ? {
              ...m,
              kerf: 0.9652,
              source:
                "WAM 2.5.0 Speed Mode feed/pierce capture; kerf 0.038 in from captured WAM account; unset pierce diameter follows kerf",
            }
          : m,
      )
      .filter(
        (m) =>
          !m.id.startsWith("gauge-") || m.source === "User-edited defaults",
      ),
  };
  const stockName = (m: JobMaterial) =>
    (m.stockKey ?? m.name).replace(/\s*[\u00b7-]\s*(coarse|medium|fine)$/i, "");

  const extra: JobMaterial[] = [];
  const stocks = new Map(
    library.materials
      .filter((m) => gaugeFamily(m.stockKey ?? m.name))
      .map((m) => [stockName(m), m]),
  );
  for (const [stock, base] of stocks)
    for (const machine of ["desktop", "pro"] as const)
      for (const g of gaugesFor(stock))
        for (const quality of ["coarse", "medium", "fine"] as const) {
          const legacyId = `gauge-${machine}-${stock.replace(/[^a-z0-9]/gi, "_")}-${g.gauge}`;
          const id =
            quality === "medium" &&
            !library.materials.some((m) => m.id === legacyId)
              ? legacyId
              : `${legacyId}-${quality}`;
          const edited = library.materials.find(
            (m) =>
              m.machine === machine &&
              stockName(m) === stock &&
              Math.abs(m.thickness - g.mm) < 1e-7 &&
              (m.quality ?? m.preset?.quality) === quality &&
              m.source === "User-edited defaults",
          );
          if (edited || library.materials.some((m) => m.id === id)) continue;
          const exact = library.materials.find(
            (m) =>
              m.machine === machine &&
              stockName(m) === stock &&
              Math.abs(m.thickness - g.mm) < 1e-7 &&
              (m.quality ?? m.preset?.quality) === quality,
          );
          // The captured profile already supplies this physical gauge and quality.
          if (exact) continue;
          extra.push({
            ...defaultMaterial(machine),
            id,
            machine,
            name: stock,
            stockKey: stock,
            quality,
            thickness: g.mm,
            kerf:
              library.machines?.[machine].kerf ?? defaultMaterial(machine).kerf,
            requiresVerification: true,
            preset: undefined,
            source: `Nominal sheet gauge thickness (${GAUGE_SOURCE}); no exact ${quality} capture for this machine and thickness. Generic defaults only; enter and verify cutting settings.`,
          });
        }
  return { ...library, materials: [...library.materials, ...extra] };
}
export function materialForMachine(
  m: JobMaterial,
  machine: JobMaterial["machine"],
): JobMaterial {
  if (m.machine === machine) return structuredClone(m);
  return {
    ...defaultMaterial(machine),
    id: `${m.id}-${machine}`,
    machine,
    name: m.name,
    stockKey: m.stockKey ?? m.name,
    thickness: m.thickness,
    quality: m.quality ?? m.preset?.quality,
    requiresVerification: true,
    source:
      "Material copied from another machine profile; cutting settings require verification",
  };
}

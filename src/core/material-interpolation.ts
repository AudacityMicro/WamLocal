import type { MaterialPreset, CutQuality } from "./material-presets";

type Values = {
  feeds: Record<CutQuality, number>;
  pierce: number;
  tabWidth: number;
  lead: number;
  abrasive: number;
};

/** Shape-preserving cubic Hermite interpolation: no oscillating global fit and
 * no overshoot past the bracketing data. */
export function monotoneInterpolate(xs: number[], ys: number[], x: number) {
  const i = xs.findIndex((t) => t > x) - 1;
  if (i < 0 || i >= xs.length - 1)
    throw Error("Interpolation requires an interior point.");
  const h = xs.slice(1).map((v, j) => v - xs[j]);
  const slopes = h.map((v, j) => (ys[j + 1] - ys[j]) / v);
  const derivative = (j: number) => {
    if (j === 0) return slopes[0];
    if (j === xs.length - 1) return slopes.at(-1)!;
    const left = slopes[j - 1],
      right = slopes[j];
    if (left * right <= 0) return 0;
    const w1 = 2 * h[j] + h[j - 1],
      w2 = h[j] + 2 * h[j - 1];
    return (w1 + w2) / (w1 / left + w2 / right);
  };
  const t = (x - xs[i]) / h[i],
    d0 = derivative(i),
    d1 = derivative(i + 1);
  const value =
    (2 * t ** 3 - 3 * t ** 2 + 1) * ys[i] +
    (t ** 3 - 2 * t ** 2 + t) * h[i] * d0 +
    (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1] +
    (t ** 3 - t ** 2) * h[i] * d1;
  return Math.max(
    Math.min(ys[i], ys[i + 1]),
    Math.min(Math.max(ys[i], ys[i + 1]), value),
  );
}

export function interpolateMaterialCurve(
  rows: readonly MaterialPreset[],
  thickness: number,
): Values {
  if (
    rows.some((p) => p.machine !== rows[0].machine || p.name !== rows[0].name)
  )
    throw Error("Cannot mix machine or material references.");
  const sorted = [...rows].sort((a, b) => a.thicknessMm - b.thicknessMm),
    hi = sorted.findIndex((p) => p.thicknessMm > thickness);
  if (hi <= 0) throw Error("Interpolation requires bracketing captures.");
  const a = sorted[hi - 1],
    b = sorted[hi];
  const at = (
    field: (p: MaterialPreset) => number,
    logX = false,
    logY = false,
  ) => {
    const xs = sorted.map((p) =>
        logX ? Math.log(p.thicknessMm) : p.thicknessMm,
      ),
      ys = sorted.map((p) =>
        logY ? Math.log(Math.max(1e-9, field(p))) : field(p),
      );
    const value = monotoneInterpolate(
      xs,
      ys,
      logX ? Math.log(thickness) : thickness,
    );
    return logY ? Math.exp(value) : value;
  };
  return {
    feeds: {
      coarse: at((p) => p.feeds.coarse, true, true),
      medium: at((p) => p.feeds.medium, true, true),
      fine: at((p) => p.feeds.fine, true, true),
    },
    pierce: at((p) => p.pierce),
    tabWidth: at((p) => p.tabWidth, true, true),
    lead: at((p) => p.lead, true),
    abrasive: Math.max(a.abrasive, b.abrasive),
  };
}

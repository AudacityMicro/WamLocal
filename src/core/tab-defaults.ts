/** Editable starting widths: .040 in at .020 in stock, .010 in by .320 in stock. */
export function defaultTabWidth(thicknessMm: number): number {
  return Number(
    Math.max(
      0.254,
      Math.min(1.016, 1.016 * Math.sqrt(0.508 / thicknessMm)),
    ).toFixed(4),
  );
}

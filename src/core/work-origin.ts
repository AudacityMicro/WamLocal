import type { Point } from "./model";
export const ORIGIN_ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center-center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type OriginAnchor = (typeof ORIGIN_ANCHORS)[number];
export function originLabel(anchor: OriginAnchor) {
  return anchor
    .split("-")
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
}
export function workOriginPoint(sheet: {
  stock: { width: number; height: number };
  workOrigin?: OriginAnchor;
}): Point {
  const i = ORIGIN_ANCHORS.indexOf(sheet.workOrigin ?? "top-left");
  return {
    x: (sheet.stock.width * (i % 3)) / 2,
    y: (sheet.stock.height * Math.floor(i / 3)) / 2,
  };
}
export function toWorkPoint(
  sheet: Parameters<typeof workOriginPoint>[0],
  p: Point,
): Point {
  const o = workOriginPoint(sheet);
  return { x: p.x - o.x, y: p.y - o.y };
}

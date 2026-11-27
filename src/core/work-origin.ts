import type { Point, Part } from "./model";
import { partBounds } from "./geometry";
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
export function workOriginPoint(
  sheet: {
    stock: { width: number; height: number };
    workOrigin?: OriginAnchor;
    workOriginReference?: "sheet" | "parts";
  },
  parts: Part[] = [],
): Point {
  const i = ORIGIN_ANCHORS.indexOf(sheet.workOrigin ?? "top-left");
  let box = {
    x: 0,
    y: 0,
    width: sheet.stock.width,
    height: sheet.stock.height,
  };
  if (sheet.workOriginReference === "parts") {
    const boxes = parts
      .filter((p) => p.contours.length)
      .map(partBounds)
      .filter((b) => Number.isFinite(b.x + b.y + b.width + b.height));
    if (boxes.length) {
      const x = Math.min(...boxes.map((b) => b.x)),
        y = Math.min(...boxes.map((b) => b.y));
      box = {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
      };
    }
  }
  return {
    x: box.x + (box.width * (i % 3)) / 2,
    y: box.y + (box.height * Math.floor(i / 3)) / 2,
  };
}
export function toWorkPoint(
  sheet: Parameters<typeof workOriginPoint>[0],
  p: Point,
  parts: Part[] = [],
): Point {
  const o = workOriginPoint(sheet, parts);
  return { x: p.x - o.x, y: p.y - o.y };
}

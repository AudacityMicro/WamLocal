import type { Point } from "../core/model";
export const MIN_PART_ZOOM = 0.6,
  MAX_PART_ZOOM = 200;
export function zoomPartAt(
  zoom: number,
  pan: Point,
  anchor: Point,
  next: number,
) {
  const value = Math.max(MIN_PART_ZOOM, Math.min(MAX_PART_ZOOM, next)),
    ratio = 1 - zoom / value;
  return {
    zoom: value,
    pan: {
      x: pan.x + (anchor.x + 24 - pan.x) * ratio,
      y: pan.y + (anchor.y + 22 - pan.y) * ratio,
    },
  };
}

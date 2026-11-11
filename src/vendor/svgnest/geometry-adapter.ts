import { area, bounds } from "../../core/geometry";
import type { Point } from "../../core/model";
export const GeometryUtil = {
  polygonArea: (p: Point[]) => -area(p),
  getPolygonBounds: bounds,
  almostEqual: (a: number, b: number) => Math.abs(a - b) < 1e-9,
};

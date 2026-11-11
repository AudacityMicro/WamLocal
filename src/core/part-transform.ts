import { bounds } from "./geometry";
import type { Part, Point } from "./model";

export function partCenter(part: Part): Point {
  const b = bounds(part.contours.flatMap((c) => c.points));
  const x = (b.x + b.width / 2) * part.scale,
    y = (b.y + b.height / 2) * part.scale;
  const angle = (part.rotation * Math.PI) / 180;
  return {
    x: part.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: part.y + x * Math.sin(angle) + y * Math.cos(angle),
  };
}
export function rotatePartFromPointer(
  part: Part,
  center: Point,
  start: Point,
  end: Point,
  snap = false,
): Part {
  if (Math.hypot(end.x - center.x, end.y - center.y) < 1e-9) return part;
  const delta =
    Math.atan2(end.y - center.y, end.x - center.x) -
    Math.atan2(start.y - center.y, start.x - center.x);
  const requested = part.rotation + (delta * 180) / Math.PI;
  const rotation = snap ? Math.round(requested / 15) * 15 : requested;
  const radians = ((rotation - part.rotation) * Math.PI) / 180;
  const x = part.x - center.x,
    y = part.y - center.y;
  return {
    ...part,
    x: center.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: center.y + x * Math.sin(radians) + y * Math.cos(radians),
    rotation: ((rotation % 360) + 360) % 360,
  };
}

import { it, expect } from "vitest";
import { MAX_PART_ZOOM, zoomPartAt } from "./preview-zoom";
it("zooms beyond the old 5x limit while keeping the cursor point stationary", () => {
  const pan = { x: 10, y: 20 },
    anchor = { x: 60, y: 80 },
    old = 5,
    next = zoomPartAt(old, pan, anchor, 50);
  expect(next.zoom).toBe(50);
  expect((anchor.x + 24 - pan.x) * old).toBeCloseTo(
    (anchor.x + 24 - next.pan.x) * next.zoom,
    8,
  );
  expect((anchor.y + 22 - pan.y) * old).toBeCloseTo(
    (anchor.y + 22 - next.pan.y) * next.zoom,
    8,
  );
  expect(zoomPartAt(50, pan, anchor, 10000).zoom).toBe(MAX_PART_ZOOM);
});

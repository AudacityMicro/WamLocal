import { memo, useMemo } from "react";
import type { Contour } from "../core/model";

/** Fit source geometry independently of its sheet placement, with visible holes. */
export const PartThumbnail = memo(function PartThumbnail({
  contours,
}: {
  contours: Contour[];
}) {
  const drawing = useMemo(() => {
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const contour of contours)
      for (const p of contour.points) {
        left = Math.min(left, p.x);
        top = Math.min(top, p.y);
        right = Math.max(right, p.x);
        bottom = Math.max(bottom, p.y);
      }
    if (!Number.isFinite(left + top + right + bottom)) return null;
    const width = right - left,
      height = bottom - top,
      pad = Math.max(width, height, 1) * 0.1;
    const path = (c: Contour) =>
      c.points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") +
      (c.closed ? "Z" : "");
    return {
      viewBox: `${left - pad} ${top - pad} ${width + 2 * pad} ${height + 2 * pad}`,
      closed: contours
        .filter((c) => c.closed)
        .map(path)
        .join(" "),
      open: contours
        .filter((c) => !c.closed)
        .map(path)
        .join(" "),
    };
  }, [contours]);
  return (
    <svg
      className="part-thumbnail"
      viewBox={drawing?.viewBox ?? "0 0 40 40"}
      aria-hidden="true"
      focusable="false"
    >
      {drawing ? (
        <>
          <path
            d={drawing.closed}
            fill="currentColor"
            fillOpacity=".18"
            fillRule="evenodd"
            stroke="currentColor"
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={drawing.open}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : (
        <rect
          x="9"
          y="9"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeDasharray="3 3"
        />
      )}
    </svg>
  );
});

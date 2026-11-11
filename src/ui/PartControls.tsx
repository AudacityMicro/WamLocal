import type { PointerEvent } from "react";
import { Copy, Trash2, RotateCw } from "lucide-react";
import type { Part, Point } from "../core/model";
import { bounds } from "../core/geometry";

export function PartControls({
  part,
  pixelsPerMm,
  view,
  onRotate,
  onDuplicate,
  onDelete,
}: {
  part: Part;
  pixelsPerMm: number;
  view: { x: number; y: number; width: number; height: number };
  onRotate: (e: PointerEvent<SVGCircleElement>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const b = bounds(part.contours.flatMap((c) => c.points));
  const unit = 1 / pixelsPerMm,
    pad = (14 * unit) / part.scale;
  const a = (part.rotation * Math.PI) / 180;
  const corners: Point[] = [
    [b.x - pad, b.y - pad],
    [b.x + b.width + pad, b.y - pad],
    [b.x + b.width + pad, b.y + b.height + pad],
    [b.x - pad, b.y + b.height + pad],
  ].map(([x, y]) => ({
    x: part.x + part.scale * (x * Math.cos(a) - y * Math.sin(a)),
    y: part.y + part.scale * (x * Math.sin(a) + y * Math.cos(a)),
  }));
  const box = bounds(corners);
  const barX = Math.max(
    view.x + 4 * unit,
    Math.min(
      box.x + box.width / 2 - 90 * unit,
      view.x + view.width - 184 * unit,
    ),
  );
  const barY = Math.max(
    view.y + 4 * unit,
    Math.min(box.y - 42 * unit, view.y + view.height - 40 * unit),
  );
  return (
    <g
      className="part-controls"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <polygon
        points={corners.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="#f5b174"
        strokeWidth={unit}
        strokeDasharray={`${4 * unit} ${3 * unit}`}
        pointerEvents="none"
      />
      {corners.map((p, i) => (
        <g key={i}>
          <circle
            role="button"
            aria-label={`Rotate part handle ${i + 1}`}
            cx={p.x}
            cy={p.y}
            r={9 * unit}
            fill="#233039"
            stroke="#f5b174"
            strokeWidth={1.5 * unit}
            style={{ cursor: "grab" }}
            onPointerDown={onRotate}
          >
            <title>Drag to rotate · Shift snaps to 15°</title>
          </circle>
          <RotateCw
            x={p.x - 5 * unit}
            y={p.y - 5 * unit}
            width={10 * unit}
            height={10 * unit}
            stroke="#f5b174"
            strokeWidth={1.5}
            pointerEvents="none"
          />
        </g>
      ))}
      <g transform={`translate(${barX} ${barY}) scale(${unit})`}>
        <foreignObject width="180" height="36">
          <div className="part-action-bar">
            <button
              aria-label="Duplicate selected part"
              title="Duplicate part"
              onClick={onDuplicate}
            >
              <Copy size={13} /> Duplicate
            </button>
            <button
              aria-label="Delete selected part"
              title="Delete part"
              onClick={onDelete}
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </foreignObject>
      </g>
    </g>
  );
}

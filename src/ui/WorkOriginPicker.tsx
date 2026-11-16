import {
  ORIGIN_ANCHORS,
  originLabel,
  type OriginAnchor,
} from "../core/work-origin";

const markerPaths: Record<OriginAnchor, string> = {
  "top-left": "M30 40V20H60",
  "top-center": "M0 20H60M30 20V28",
  "top-right": "M0 20H30V40",
  "center-left": "M30 0V40M30 20H38",
  "center-center": "M30 12V28M22 20H38",
  "center-right": "M30 0V40M22 20H30",
  "bottom-left": "M30 0V20H60",
  "bottom-center": "M0 20H60M30 12V20",
  "bottom-right": "M0 20H30V0",
};
export function WorkOriginPicker({
  value = "top-left",
  onChange,
  label = "Sheet origin",
}: {
  value?: OriginAnchor;
  onChange: (anchor: OriginAnchor) => void;
  label?: string;
}) {
  return (
    <div className="work-origin-picker">
      <span>{label}</span>
      <div className="origin-grid" role="group" aria-label={label}>
        {ORIGIN_ANCHORS.map((anchor) => (
          <button
            key={anchor}
            type="button"
            aria-label={`${label} ${originLabel(anchor)}`}
            title={originLabel(anchor)}
            aria-pressed={value === anchor}
            onClick={() => onChange(anchor)}
          >
            <svg
              viewBox="0 0 60 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d={markerPaths[anchor]}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <span className="origin-dot" aria-hidden="true" />
          </button>
        ))}
      </div>
      <small>{originLabel(value)}</small>
    </div>
  );
}

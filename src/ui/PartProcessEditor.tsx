import type { Part } from "../core/model";
export function PartProcessEditor({
  part,
  selected,
  onSelect,
  onChange,
  onTabs,
  onEntry,
}: {
  part: Part;
  selected: number;
  onSelect: (i: number) => void;
  onChange: (p: Part) => void;
  onTabs: () => void;
  onEntry: () => void;
}) {
  const contour = part.contours[selected] ?? part.contours[0];
  if (!contour) return null;
  const update = (change: Partial<typeof contour>) =>
    onChange({
      ...part,
      contours: part.contours.map((c, i) =>
        i === selected ? { ...c, ...change } : c,
      ),
    });
  return (
    <section>
      <h3>CONTOUR CUT SETTINGS</h3>
      <label className="field">
        <span>Contour</span>
        <select
          value={selected}
          onChange={(e) => onSelect(Number(e.target.value))}
        >
          {part.contours.map((c, i) => (
            <option key={i} value={i}>
              {i + 1} · {c.hole ? "Hole" : c.closed ? "Outer" : "Open"} ·{" "}
              {c.points.length} nodes
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Contour role</span>
        <select
          disabled={!contour.closed}
          value={contour.hole ? "hole" : "outer"}
          onChange={(e) => update({ hole: e.target.value === "hole" })}
        >
          <option value="outer">Outer profile</option>
          <option value="hole">Hole / opening</option>
        </select>
      </label>
      <label className="field">
        <span>Contour kerf cut</span>
        <select
          value={contour.cut ?? "inherit"}
          onChange={(e) =>
            update({
              cut:
                e.target.value === "inherit"
                  ? undefined
                  : (e.target.value as Part["cut"]),
            })
          }
        >
          <option value="inherit">Use part default (holes inverted)</option>
          <option value="outside">Outside this contour</option>
          <option value="inside">Inside this contour</option>
          <option value="centerline">Centerline</option>
        </select>
      </label>
      <label className="field">
        <span>Tab placement</span>
        <select
          disabled={!contour.closed}
          value={contour.tabMode ?? "auto"}
          onChange={(e) =>
            update({ tabMode: e.target.value as "auto" | "manual" | "none" })
          }
        >
          <option value="auto">Automatic defaults</option>
          <option value="manual">Manual locations</option>
          <option value="none">No tabs</option>
        </select>
      </label>
      <div className="button-row">
        <button
          disabled={!contour.closed}
          onClick={() => {
            update({ tabMode: "manual" });
            onTabs();
          }}
        >
          Place tabs on profile
        </button>
        <button disabled={!contour.closed} onClick={onEntry}>
          Set pierce entry
        </button>
      </div>
      <label className="field">
        <span>Entry location · % of contour</span>
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={(contour.startPosition ?? 0) * 100}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v) && v >= 0 && v <= 100)
              update({ startPosition: v / 100 });
          }}
        />
      </label>
      {(contour.tabs ?? []).map((tab, index) => (
        <div className="tab-row" key={index}>
          <label>
            Location %
            <input
              aria-label={`Tab ${index + 1} location`}
              type="number"
              min="0"
              max="100"
              value={Number((tab.position * 100).toFixed(3))}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                if (v >= 0 && v <= 100)
                  update({
                    tabs: contour.tabs!.map((t, i) =>
                      i === index ? { ...t, position: v / 100 } : t,
                    ),
                  });
              }}
            />
          </label>
          <label>
            Width mm
            <input
              aria-label={`Tab ${index + 1} width`}
              type="number"
              min="0.01"
              max="20"
              step="0.1"
              value={tab.width}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                if (v > 0 && v <= 20)
                  update({
                    tabs: contour.tabs!.map((t, i) =>
                      i === index ? { ...t, width: v } : t,
                    ),
                  });
              }}
            />
          </label>
          <button
            aria-label={`Remove tab ${index + 1}`}
            onClick={() =>
              update({ tabs: contour.tabs!.filter((_, i) => i !== index) })
            }
          >
            ×
          </button>
        </div>
      ))}
      <p className="micro">
        Click a profile to set a tab or entry location. Manual tab widths are
        physical millimetres. Open contours start at their first endpoint.
      </p>
    </section>
  );
}

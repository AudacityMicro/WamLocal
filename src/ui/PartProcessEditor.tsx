import { LengthInput, useDisplayUnits } from "./display-units";
import type { Part } from "../core/model";
export function PartProcessEditor({
  part,
  selected,
  defaultLead,
  onChange,
  onTabs,
  onEntry,
}: {
  part: Part;
  selected: number;
  defaultLead: number;
  onChange: (p: Part) => void;
  onTabs: () => void;
  onEntry: () => void;
}) {
  const u = useDisplayUnits();
  const contour = part.contours[selected];
  if (!contour)
    return (
      <p className="micro">
        Click a contour in the preview to edit its cut, lead-in, tabs and entry
        point.
      </p>
    );
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
      <p className="micro">
        Contour {selected + 1}  - {" "}
        {contour.hole ? "Hole" : contour.closed ? "Outer profile" : "Open path"}
      </p>
      <label className="field">
        <span>Contour lead-in length  -  {u.unit}</span>
        <LengthInput
          aria-label="Contour lead-in length"
          value={contour.lead ?? defaultLead}
          min={0}
          max={30}
          onChange={(lead) => update({ lead })}
        />
      </label>
      <button
        disabled={contour.lead === undefined}
        onClick={() => update({ lead: undefined })}
      >
        Use part lead-in default
      </button>
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
            Width {u.unit}
            <LengthInput
              aria-label={`Tab ${index + 1} width`}
              min={0.01}
              max={20}
              value={tab.width}
              onChange={(v) =>
                update({
                  tabs: contour.tabs!.map((t, i) =>
                    i === index ? { ...t, width: v } : t,
                  ),
                })
              }
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
        Click a profile to set a tab or entry location. Open contours start at
        their first endpoint.
      </p>
    </section>
  );
}

import { NumericInput } from "./NumericInput";
import { SettingsScope } from "./SettingDefaults";
import type { JobMaterial } from "../core/job";
import { LengthInput, useDisplayUnits } from "./display-units";
import type { Part } from "../core/model";
export function PartProcessEditor({
  part,
  selected,
  defaultLead,
  material,
  onChange,
  onTabs,
  onEntry,
}: {
  part: Part;
  selected: number;
  defaultLead: number;
  material?: JobMaterial;
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
    <SettingsScope
      title={`${material?.name ?? "Material"} · contour defaults`}
      material={material}
      prefix="contour."
      values={{
        leadInOverlap:
          contour.leadInOverlap ??
          part.process?.leadInOverlap ??
          material?.leadInOverlap ??
          0,
        leadOutOverlap:
          contour.leadOutOverlap ??
          part.process?.leadOutOverlap ??
          material?.leadOutOverlap ??
          0,
        lead: contour.lead ?? defaultLead,
        cut: contour.cut ?? null,
        tabMode: contour.tabMode ?? "auto",
      }}
      fallbacks={{
        leadInOverlap:
          part.process?.leadInOverlap ?? material?.leadInOverlap ?? 0,
        leadOutOverlap:
          part.process?.leadOutOverlap ?? material?.leadOutOverlap ?? 0,
        lead: defaultLead,
        cut: null,
        tabMode: "auto",
      }}
      onRevert={(key, v) => update({ [key]: v === null ? undefined : v })}
    >
      <section>
        <h3>CONTOUR CUT SETTINGS</h3>
        <p className="micro">
          Contour {selected + 1} -{" "}
          {contour.hole
            ? "Hole"
            : contour.closed
              ? "Outer profile"
              : "Open path"}
        </p>
        <label className="field">
          <span>Contour lead-in length - {u.unit}</span>
          <LengthInput
            data-default-key="lead"
            aria-label="Contour lead-in length"
            value={contour.lead ?? defaultLead}
            min={0}
            max={30}
            onChange={(lead) => update({ lead })}
          />
        </label>
        {(["leadInOverlap", "leadOutOverlap"] as const).map((key) => (
          <label className="field" key={key}>
            <span>
              {key === "leadInOverlap" ? "Lead-in overlap" : "Lead-out overlap"}{" "}
              · {u.unit}
            </span>
            <LengthInput
              data-default-key={key}
              aria-label={
                key === "leadInOverlap"
                  ? "Contour lead-in overlap"
                  : "Contour lead-out overlap"
              }
              min={0}
              max={30}
              value={
                contour[key] ?? part.process?.[key] ?? material?.[key] ?? 0
              }
              onChange={(value) => update({ [key]: value })}
            />
          </label>
        ))}
        <button
          disabled={
            contour.leadInOverlap === undefined &&
            contour.leadOutOverlap === undefined
          }
          onClick={() =>
            update({ leadInOverlap: undefined, leadOutOverlap: undefined })
          }
        >
          Use part overlap defaults
        </button>
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
            data-default-key="cut"
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
            data-default-key="tabMode"
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
              <NumericInput
                aria-label={`Tab ${index + 1} location`} unit="%"

                min="0"
                max="100"
                value={Number((tab.position * 100).toFixed(3))}
                onChange={(e) => {
                  const v = e;
                  if (v >= 0 && v <= 100)
                    update({
                      tabs: contour.tabs!.map((t, i) =>
                        i === index ? { ...t, position: v / 100 } : t,
                      ),
                    });
                }}
              />
            </label>
            <SettingsScope
              title={`${material?.name ?? "Material"} · tab defaults`}
              material={material}
              prefix="tabs."
              values={{ width: tab.width }}
              fallbacks={{ width: material?.tabWidth ?? 0.254 }}
              onRevert={(key, v) =>
                update({
                  tabs: contour.tabs!.map((t, i) =>
                    i === index ? { ...t, width: v } : t,
                  ),
                })
              }
            >
              <label>
                Width {u.unit}
                <LengthInput
                  data-default-key="width"
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
            </SettingsScope>
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
          Drag yellow handles to move tabs, blue circles to move lead-in
          entries, and blue squares to adjust lead-in length. Open contours
          start at their first endpoint.
        </p>
      </section>
    </SettingsScope>
  );
}

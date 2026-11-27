import { defaultTabWidth } from "../core/tab-defaults";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { id } from "../core/model";
import {
  jobMaterialSchema,
  type JobMaterial,
  type MaterialLibrary,
} from "../core/job";
import {
  materialName,
  materialQuality,
  thicknessKey,
} from "../core/material-selection";
import {
  materialHierarchy,
  MATERIAL_FAMILIES,
} from "../core/material-hierarchy";
import { NumericInput } from "./NumericInput";
import { LengthInput, useDisplayUnits } from "./display-units";
export function JobMaterialDialog({
  mode,
  current,
  library,
  onSave,
  onClose,
}: {
  mode: "new" | "edit";
  current: JobMaterial;
  library: MaterialLibrary;
  onSave: (records: JobMaterial[], selected: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    u = useDisplayUnits(),
    identity = materialHierarchy(current);
  const [draft, setDraft] = useState({ ...current, ...identity }),
    [name, setName] = useState(mode === "new" ? "" : current.name),
    [error, setError] = useState("");
  const [feeds, setFeeds] = useState(
    () =>
      Object.fromEntries(
        (["coarse", "medium", "fine"] as const).map((q) => [
          q,
          library.materials.find(
            (m) =>
              m.machine === current.machine &&
              materialName(m) === materialName(current) &&
              thicknessKey(m.thickness) === thicknessKey(current.thickness) &&
              materialQuality(m) === q,
          )?.feed ?? current.feed,
        ]),
      ) as Record<"coarse" | "medium" | "fine", number>,
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const update = (key: string, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));
  function save() {
    try {
      if (!name.trim()) throw Error("Enter a material name.");
      if (
        mode === "new" &&
        library.materials.some(
          (m) =>
            m.machine === current.machine &&
            materialName(m).toLowerCase() === name.trim().toLowerCase(),
        )
      )
        throw Error("That material already exists. Edit its preset instead.");
      const qualities =
        mode === "new"
          ? (["coarse", "medium", "fine"] as const)
          : ([materialQuality(current)] as const);
      const profiles = qualities.map((quality) =>
        jobMaterialSchema.parse({
          ...draft,
          id: mode === "new" ? id() : current.id,
          name: mode === "new" ? `${name.trim()} · ${quality}` : name.trim(),
          stockKey: mode === "new" ? name.trim() : materialName(current),
          grade: mode === "new" ? name.trim() : draft.grade,
          quality,
          feed:
            mode === "new" ? feeds[quality as keyof typeof feeds] : draft.feed,
          organizationRevision: Date.now(),
          settingDefaults: mode === "new" ? undefined : current.settingDefaults,
          preset: undefined,
          source: "User-edited defaults",
        }),
      );
      onSave(
        profiles,
        (
          profiles.find((m) => m.quality === materialQuality(current)) ??
          profiles.find((m) => m.quality === "medium") ??
          profiles[0]
        ).id,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="nesting-settings-dialog job-material-dialog"
      aria-label={mode === "new" ? "New material" : "Edit material preset"}
      onCancel={onClose}
    >
      <header>
        <h2>{mode === "new" ? "New material" : "Edit material preset"}</h2>
        <button onClick={onClose}>Cancel</button>
      </header>
      <p>
        WAZER {current.machine === "pro" ? "Pro" : "Desktop"}
        {mode === "edit"
          ? ` · ${materialQuality(current)}`
          : " · Coarse, medium and fine profiles"}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="field-grid">
        <label className="field">
          <span>{mode === "new" ? "Material name" : "Preset name"}</span>
          <input
            autoFocus
            aria-label="Material preset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Family</span>
          <select
            aria-label="Material preset family"
            value={draft.family}
            onChange={(e) => update("family", e.target.value)}
          >
            {MATERIAL_FAMILIES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Class</span>
          <input
            aria-label="Material preset class"
            value={draft.materialClass}
            onChange={(e) => update("materialClass", e.target.value)}
          />
        </label>
        <label className="field">
          <span>Thickness · {u.unit}</span>
          <LengthInput
            aria-label="Material preset thickness"
            min={0.001}
            value={draft.thickness}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                thickness: v,
                ...(d.tabWidth === d.tabDefaultWidthMm
                  ? {
                      tabWidth: defaultTabWidth(v),
                      tabDefaultWidthMm: defaultTabWidth(v),
                    }
                  : {}),
              }))
            }
          />
        </label>
        {mode === "new" ? (
          (["coarse", "medium", "fine"] as const).map((q) => (
            <label className="field" key={q}>
              <span>
                {q[0].toUpperCase() + q.slice(1)} feed · {u.unit}/min
              </span>
              <LengthInput
                aria-label={`${q} material feed`}
                rate
                min={0.0001}
                value={feeds[q]}
                onChange={(v) => setFeeds({ ...feeds, [q]: v })}
              />
            </label>
          ))
        ) : (
          <label className="field">
            <span>Cut feed · {u.unit}/min</span>
            <LengthInput
              aria-label="Material cut feed"
              rate
              min={0.0001}
              value={draft.feed}
              onChange={(v) => update("feed", v)}
            />
          </label>
        )}
        <label className="field">
          <span>Pierce time · s</span>
          <NumericInput
            aria-label="Material pierce time"
            unit="s"
            value={draft.pierce}
            min={0}
            onChange={(v) => update("pierce", v)}
          />
        </label>
        <label className="field">
          <span>Lead-in length · {u.unit}</span>
          <LengthInput
            aria-label="Material lead-in length"
            value={draft.lead}
            min={0}
            max={30}
            onChange={(v) => update("lead", v)}
          />
        </label>
        <label className="field">
          <span>Lead-in shape</span>
          <select
            aria-label="Material lead-in shape"
            value={draft.leadStyle ?? "arc"}
            onChange={(e) => update("leadStyle", e.target.value)}
          >
            <option value="arc">Tangent arc</option>
            <option value="straight">Straight</option>
          </select>
        </label>
        <label className="field">
          <span>Tab width · {u.unit}</span>
          <LengthInput
            aria-label="Material tab width"
            value={draft.tabWidth}
            min={0}
            max={20}
            onChange={(v) => update("tabWidth", v)}
          />
        </label>
        <label className="field">
          <span>Tabs per contour</span>
          <NumericInput
            aria-label="Material tab count"
            integer
            value={draft.tabCount}
            min={0}
            max={20}
            step={1}
            onChange={(v) => {
              if (Number.isInteger(v)) update("tabCount", v);
            }}
          />
        </label>
      </div>
      <footer>
        <button className="primary" onClick={save}>
          Save &amp; use in job
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}

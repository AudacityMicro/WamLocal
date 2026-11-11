import { useState } from "react";
import { type Project } from "../core/model";
import {
  activeMaterialPreset,
  applyMaterialPreset,
  materialPresets,
  presetIssue,
  presetSource,
  type CutQuality,
} from "../core/material-presets";

export function MaterialPresets({
  project,
  onApply,
}: {
  project: Project;
  onApply: (p: Project) => void;
}) {
  const active = activeMaterialPreset(project);
  const [name, setName] = useState(active?.name ?? "Aluminum - 6061");
  const [thickness, setThickness] = useState(active?.id ?? "pro-0-0.125");
  const [quality, setQuality] = useState<CutQuality>(
    project.material.preset?.quality ?? "medium",
  );
  const [error, setError] = useState("");
  const choices = materialPresets.filter((p) => p.name === name);
  const selected = choices.find((p) => p.id === thickness) ?? choices[0];
  const issue = presetIssue(selected);
  const categories = [...new Set(materialPresets.map((p) => p.category))];
  return (
    <section className="material-presets">
      <h3>WAM REFERENCE PRESETS</h3>
      <p className="micro">
        {presetSource}. Recorded thicknesses only; Speed Mode.
      </p>
      {project.machine !== "pro" ? (
        <div className="notice">
          <p>
            Desktop presets are not available yet. Choose WAZER Pro above to use
            these captures, or enter custom parameters below.
          </p>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Preset material</span>
            <select
              value={name}
              onChange={(e) => {
                const next = materialPresets.filter(
                  (p) => p.name === e.target.value,
                );
                setName(e.target.value);
                setThickness(
                  (
                    next.find((p) => p.thicknessIn === selected.thicknessIn) ??
                    next.find((p) => p.thicknessIn === 0.125) ??
                    next[0]
                  ).id,
                );
                setError("");
              }}
            >
              {categories.map((category) => (
                <optgroup key={category} label={category}>
                  {[
                    ...new Set(
                      materialPresets
                        .filter((p) => p.category === category)
                        .map((p) => p.name),
                    ),
                  ].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="field-grid">
            <label className="field">
              <span>Recorded thickness</span>
              <select
                value={selected.id}
                onChange={(e) => {
                  setThickness(e.target.value);
                  setError("");
                }}
              >
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.thicknessIn} in / {Number(p.thicknessMm.toFixed(5))} mm
                    {presetIssue(p) ? " · outlier" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Cut quality</span>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as CutQuality)}
              >
                <option value="coarse">Coarse</option>
                <option value="medium">Medium</option>
                <option value="fine">Fine</option>
              </select>
            </label>
          </div>
          <p className="preset-values">
            {Number(selected.feeds[quality].toFixed(2))} mm/min ·{" "}
            {selected.pierce} s pierce
            <br />
            {selected.abrasive} g/min abrasive · {selected.tabWidth} mm tabs ·{" "}
            {selected.lead} mm leads
          </p>
          {issue ? (
            <p className="preset-warning" role="alert">
              {issue}
            </p>
          ) : null}
          <button
            className="primary wide"
            disabled={!!issue}
            onClick={() => {
              try {
                onApply(applyMaterialPreset(project, selected.id, quality));
                setError("");
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Apply material preset
          </button>
          {error ? <p role="alert">{error}</p> : null}
          <p className="micro">
            Keeps kerf and tab count. Other thicknesses use custom parameters;
            no interpolation.
          </p>
        </>
      )}
      <p className="preset-status">
        {active
          ? `Applied: ${active.name} · ${active.thicknessIn} in · ${project.material.preset!.quality}`
          : "Current settings: custom"}
      </p>
    </section>
  );
}

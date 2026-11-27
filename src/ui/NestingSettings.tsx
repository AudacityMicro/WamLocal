import { NumericInput } from "./NumericInput";
import { SettingsScope } from "./SettingDefaults";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Settings2, X } from "lucide-react";
import type { Job } from "../core/job";
import type { Project } from "../core/model";
import { searchSettings, searchBudget } from "../core/nesting-search";

export function NestingSettings({
  job,
  onChange,
  project,
  scope = "job",
  disabled = false,
}: {
  job: Job;
  onChange: (job: Job) => void;
  project?: Project;
  scope?: "job" | "sheet";
  disabled?: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (advanced && !dialog.current?.open) dialog.current?.showModal();
  }, [advanced]);
  const cfg = searchSettings(job.nesting),
    budget = searchBudget(project ?? job, cfg.allowRotation);
  const update = (change: Partial<NonNullable<Job["nesting"]>>) =>
    onChange({ ...job, nesting: { ...cfg, ...change } });
  const select = (
    label: string,
    key: "effort" | "method" | "order" | "objective" | "detail",
    options: [string, string][],
  ) => (
    <label className="field" key={key} data-default-key={key}>
      <span>{label}</span>
      <select
        aria-label={label}
        value={cfg[key]}
        onChange={(e) => update({ [key]: e.target.value })}
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const numeric = (
    label: string,
    key:
      | "budgetSeconds"
      | "maxAutoSeconds"
      | "restarts"
      | "stallPasses"
      | "seed"
      | "maxSheets",
    min: number,
    max: number,
  ) => (
    <label className="field" data-default-key={key}>
      <span>{label}</span>
      <NumericInput
        aria-label={label}
        integer
        unit={
          key === "budgetSeconds" || key === "maxAutoSeconds" ? "s" : undefined
        }

        min={min}
        max={max}
        step={1}
        value={cfg[key]}
        onChange={(e) => {
          const n = e;
          if (Number.isInteger(n) && n >= min && n <= max) update({ [key]: n });
        }}
      />
    </label>
  );
  return (
    <SettingsScope
      title="Nesting defaults"
      prefix="nesting."
      values={cfg}
      fallbacks={searchSettings(undefined)}
      onRevert={(key, v) => update({ [key]: v })}
    >
      <fieldset className="nesting-options" disabled={disabled}>
        <div className="nesting-controls-header">
          <button
            type="button"
            aria-label="Nesting settings"
            onClick={() => setAdvanced(true)}
          >
            <Settings2 size={14} />
            Settings
          </button>
        </div>
        <div className="nesting-option-fields">
          {select("Search effort", "effort", [
            ["fast", "Fast"],
            ["balanced", "Balanced"],
            ["thorough", "Thorough"],
          ])}
          {select("Packing method", "method", [
            ["auto", "Automatic (bounds + SVGnest)"],
            ["outline", "SVGnest outlines"],
            ["bounds", "Bounding boxes (fast)"],
          ])}
          {select("Part ordering", "order", [
            ["area", "Largest area first"],
            ["longest", "Longest side first"],
            ["perimeter", "Longest perimeter first"],
            ["input", "Part list order"],
          ])}
          {select("Layout goal", "objective", [
            ["compact", "Compact layout"],
            ["height", "Minimize used height"],
            ["width", "Minimize used width"],
          ])}
          <label className="check">
            <input
              type="checkbox"
              data-default-key="allowRotation"
              checked={cfg.allowRotation}
              onChange={(e) => update({ allowRotation: e.target.checked })}
            />
            Allow rotation
          </label>
          {cfg.allowRotation && (
            <label className="field">
              <span>Allowed rotation step</span>
              <NumericInput
                data-default-key="rotationStep"
                aria-label="Allowed rotation step"
                integer
                unit="deg"

                min={1}
                max={90}
                step={1}
                value={cfg.rotationStep}
                onChange={(e) => {
                  const n = e;
                  if (Number.isInteger(n) && n >= 1 && n <= 90)
                    update({ rotationStep: n });
                }}
              />
              <small>degrees (1-90)</small>
            </label>
          )}
          <label className="check">
            <input
              type="checkbox"
              data-default-key="optimize"
              checked={cfg.optimize}
              onChange={(e) => update({ optimize: e.target.checked })}
            />
            Optimize with multiple passes
          </label>
          <label className="check">
            <input
              type="checkbox"
              data-default-key="insideHoles"
              checked={cfg.insideHoles}
              onChange={(e) => update({ insideHoles: e.target.checked })}
            />
            Allow nesting inside holes
          </label>
          {scope === "job" && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  data-default-key="allowNewSheets"
                  checked={cfg.allowNewSheets}
                  onChange={(e) => update({ allowNewSheets: e.target.checked })}
                />
                Create additional sheets when needed
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  data-default-key="preservePlaced"
                  checked={cfg.preservePlaced}
                  onChange={(e) => update({ preservePlaced: e.target.checked })}
                />
                Keep current placements and fill remaining quantities
              </label>
            </>
          )}
        </div>
        <p className="micro">
          {budget.automatic
            ? `Starts with about ${Math.ceil(budget.initialMs / 1000)} seconds for ${budget.copies} copies. Extends while layouts improve, up to ${cfg.maxAutoSeconds} seconds.`
            : `Uses a shared ${cfg.budgetSeconds}-second limit.`}{" "}
          The best layout is kept when time runs out. Locked placements and
          grain rules are always honored.
        </p>
        {cfg.insideHoles && (
          <p className="micro">
            Nested parts cut before the containing hole. Check tabs, support and
            pierce clearance in the preview.
          </p>
        )}
        <p className="micro">
          Locks, grain rules and hole nesting use constrained outline placement.
          Candidate detail adjusts that search. No result proves a layout
          impossible.
        </p>
      </fieldset>
      {advanced &&
        createPortal(
          <dialog
            ref={dialog}
            className="nesting-settings-dialog"
            aria-labelledby="nesting-settings-title"
            onCancel={() => setAdvanced(false)}
          >
            <header>
              <h2 id="nesting-settings-title">Nesting settings</h2>
              <button
                aria-label="Close nesting settings"
                onClick={() => setAdvanced(false)}
              >
                <X size={18} />
              </button>
            </header>
            <fieldset disabled={disabled} className="nesting-options">
              <div className="nesting-option-fields">
                <label className="field">
                  <span>Time budget</span>
                  <select
                    data-default-key="budgetMode"
                    aria-label="Time budget"
                    value={cfg.budgetMode}
                    onChange={(e) =>
                      update({ budgetMode: e.target.value as "auto" | "fixed" })
                    }
                  >
                    <option value="auto">Automatic</option>
                    <option value="fixed">Fixed limit</option>
                  </select>
                </label>
                {cfg.budgetMode === "auto"
                  ? numeric(
                      "Automatic time ceiling - seconds",
                      "maxAutoSeconds",
                      5,
                      900,
                    )
                  : numeric(
                      "Fixed time limit - seconds",
                      "budgetSeconds",
                      1,
                      900,
                    )}
                {numeric("Maximum search passes", "restarts", 1, 64)}
                {numeric("Stop after unimproved passes", "stallPasses", 1, 10)}
                {select("Candidate detail", "detail", [
                  ["coarse", "Coarse"],
                  ["normal", "Normal"],
                  ["fine", "Fine"],
                ])}
                <label className="field">
                  <span>Search seed</span>
                  <input
                    aria-label="Search seed"
                    readOnly
                    value={job.nesting?.seed ?? "Randomized every run"}
                  />
                  <small>
                    A new seed is generated for every job or sheet search.
                  </small>
                </label>
                {scope === "job" &&
                  numeric("Maximum total sheets", "maxSheets", 1, 500)}
              </div>
            </fieldset>
            <p className="micro">
              Pass limits apply to multi-pass optimization. The sheet ceiling
              limits automatic sheet creation; existing sheets are retained.
            </p>
            <footer>
              <button onClick={() => setAdvanced(false)}>Done</button>
            </footer>
          </dialog>,
          document.body,
        )}
    </SettingsScope>
  );
}

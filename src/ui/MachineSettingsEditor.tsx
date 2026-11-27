import { NumericInput } from "./NumericInput";
import { SettingsScope } from "./SettingDefaults";
import { useState } from "react";
import { LengthInput, useDisplayUnits } from "./display-units";
import {
  defaultImportSettings,
  type ImportSettings,
} from "../core/import-settings";
import {
  defaultMachineSettings,
  type MachineSettings,
} from "../core/machine-settings";
export function MachineSettingsEditor({
  active,
  profiles,
  onChange,
  preferred,
  onSelect,
  importSettings = defaultImportSettings(),
  onImportChange,
}: {
  active: "desktop" | "pro";
  profiles: Partial<Record<"desktop" | "pro", MachineSettings>>;
  onChange: (machine: "desktop" | "pro", settings: MachineSettings) => void;
  preferred: "desktop" | "pro";
  onSelect: (machine: "desktop" | "pro", applyToJob: boolean) => void;
  importSettings?: ImportSettings;
  onImportChange: (settings: ImportSettings) => void;
}) {
  const [machine, setMachine] = useState(active),
    u = useDisplayUnits();
  const factory = defaultMachineSettings(machine);
  const profile = profiles[machine] ?? factory;
  const current = {
    ...factory,
    ...profile,
    abrasiveCostPerKg: profile.abrasiveCostPerKg ?? factory.abrasiveCostPerKg,
    runningCostPerHour:
      profile.runningCostPerHour ?? factory.runningCostPerHour,
    currency: profile.currency ?? factory.currency,
  };
  const priceFactor = u.unit === "in" ? 0.45359237 : 1;
  const change = (value: Partial<MachineSettings>) =>
    onChange(machine, { ...current, ...value });
  return (
    <SettingsScope
      title={`WAZER ${machine === "pro" ? "Pro" : "Desktop"} defaults`}
      prefix={`machine.${machine}.`}
      values={current}
      fallbacks={factory}
      onRevert={(key, v) => change({ [key]: v === null ? undefined : v })}
    >
      <main className="workspace machine-settings-page">
        <h1>Machine settings</h1>
        <SettingsScope
          title="Application defaults"
          prefix="application."
          values={{ defaultMachine: preferred }}
          fallbacks={{ defaultMachine: "desktop" }}
          onRevert={(key, v) => onSelect(v, false)}
        >
          <label className="field">
            <span>Default machine for new jobs</span>
            <select
              data-default-key="defaultMachine"
              aria-label="Default machine for new jobs"
              value={preferred}
              onChange={(e) =>
                onSelect(e.target.value as typeof machine, false)
              }
            >
              <option value="desktop">WAZER Desktop</option>
              <option value="pro">WAZER Pro</option>
            </select>
          </label>
        </SettingsScope>
        <p>Current job: WAZER {active === "pro" ? "Pro" : "Desktop"}</p>
        <label className="field">
          <span>Machine profile</span>
          <select
            value={machine}
            onChange={(e) => setMachine(e.target.value as typeof machine)}
          >
            <option value="desktop">WAZER Desktop</option>
            <option value="pro">WAZER Pro</option>
          </select>
        </label>
        <button
          disabled={machine === active}
          onClick={() => onSelect(machine, true)}
        >
          Use this machine for current job
        </button>
        <p className="micro">
          Changing this job's machine reapplies matching
          material/thickness/quality profiles. Rates are never copied between
          machines.
        </p>
        <section>
          <h2>Cutting process</h2>
          <label className="field">
            <span>Kerf width - {u.unit}</span>
            <LengthInput
              data-default-key="kerf"
              aria-label="Machine kerf width"
              value={current.kerf}
              min={0.001}
              max={10}
              step={0.01}
              onChange={(kerf) => change({ kerf })}
            />
          </label>
          <label className="field">
            <span>Abrasive usage - g/min</span>
            <NumericInput
              data-default-key="abrasive"
              aria-label="Machine abrasive usage"
              unit="g/min"

              min={0}
              max={10000}
              value={current.abrasive}
              onChange={(e) => {
                const abrasive = e;
                if (
                  Number.isFinite(abrasive) &&
                  abrasive >= 0 &&
                  abrasive <= 10000
                )
                  change({ abrasive });
              }}
            />
          </label>
          <p className="micro">
            An unset part pierce diameter uses this kerf width. Abrasive usage
            estimates include cutting and piercing time.
          </p>
        </section>
        <section>
          <h2>Cutting costs</h2>
          <p>
            WAZER defaults: $0.53/lb abrasive ($1.16845/kg); Desktop $5.22/hour,
            Pro $6.64/hour, USD.
          </p>
          <button
            onClick={() =>
              change({
                abrasiveCostPerKg: factory.abrasiveCostPerKg,
                runningCostPerHour: factory.runningCostPerHour,
                currency: factory.currency,
              })
            }
          >
            Use WAZER cost defaults
          </button>
          <p className="micro">
            Reference defaults are WAM demo prices. Set your own abrasive price
            and hourly costs for your shop.
          </p>
          <label className="field">
            <span>Currency</span>
            <select
              data-default-key="currency"
              aria-label="Cost currency"
              value={current.currency ?? "USD"}
              onChange={(e) => change({ currency: e.target.value })}
            >
              {[
                ...new Set([
                  current.currency ?? "USD",
                  "USD",
                  "CAD",
                  "EUR",
                  "GBP",
                ]),
              ].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              [
                "abrasiveCostPerKg",
                `Abrasive cost / ${u.unit === "in" ? "lb" : "kg"}`,
              ],
              ["runningCostPerHour", "Other running costs / hour"],
            ] as const
          ).map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <NumericInput
                data-default-key={key}
                aria-label={label}
                unit={
                  key === "abrasiveCostPerKg"
                    ? `1/${u.unit === "in" ? "lb" : "kg"}`
                    : "1/h"
                }

                min={0}
                max={
                  key === "abrasiveCostPerKg" ? 100000 * priceFactor : 100000
                }
                step={0.01}
                value={
                  current[key] === undefined
                    ? ""
                    : Number(
                        (
                          current[key]! *
                          (key === "abrasiveCostPerKg" ? priceFactor : 1)
                        ).toFixed(6),
                      )
                }
                key={u.unit}
                placeholder="Not configured"
                onClear={() => change({ [key]: undefined })}
                onChange={(e) => {
                  const n = e;
                  if (
                    Number.isFinite(n) &&
                    n >= 0 &&
                    n <=
                      100000 * (key === "abrasiveCostPerKg" ? priceFactor : 1)
                  )
                    change({
                      [key]:
                        n / (key === "abrasiveCostPerKg" ? priceFactor : 1),
                    });
                }}
              />
            </label>
          ))}
          <p className="micro">
            Posting shows abrasive cost and other running cost separately. Enter
            0 for a cost you intentionally exclude. Stock, setup, labor and
            taxes are excluded unless included in your hourly rate.
          </p>
        </section>
        <section>
          <h2>Maximum cutting area</h2>
          <div className="field-grid">
            <label className="field">
              <span>Width - {u.unit}</span>
              <LengthInput
                data-default-key="width"
                aria-label="Maximum cutting width"
                value={current.width}
                min={1}
                max={460}
                onChange={(width) => change({ width })}
              />
            </label>
            <label className="field">
              <span>Height - {u.unit}</span>
              <LengthInput
                data-default-key="height"
                aria-label="Maximum cutting height"
                value={current.height}
                min={1}
                max={305}
                onChange={(height) => change({ height })}
              />
            </label>
          </div>
          <p className="micro">
            The cutting area can be reduced within the WAZER travel envelope.
            Existing stock stays the same size and receives a warning if it
            exceeds the area.
          </p>
        </section>
        <SettingsScope
          title="Import defaults"
          prefix="import."
          values={importSettings}
          fallbacks={defaultImportSettings()}
          onRevert={(key, v) => onImportChange({ ...importSettings, [key]: v })}
        >
          <section id="import-settings">
            <h2>Vector import settings</h2>
            <label className="field">
              <span>Curve tolerance · {u.unit}</span>
              <LengthInput
                data-default-key="curveToleranceMm"
                aria-label="Import curve tolerance"
                value={importSettings.curveToleranceMm}
                min={0.0001}
                max={5}
                step={0.001}
                onChange={(curveToleranceMm) =>
                  onImportChange({ ...importSettings, curveToleranceMm })
                }
              />
            </label>
            <label className="field">
              <span>Artwork tracing resolution · DPI</span>
              <NumericInput
                data-default-key="traceDpi"
                aria-label="Artwork tracing resolution"
                integer
                min={72}
                max={2400}
                value={importSettings.traceDpi}
                onChange={(e) => {
                  const n = e;
                  if (Number.isInteger(n) && n >= 72 && n <= 2400)
                    onImportChange({ ...importSettings, traceDpi: n });
                }}
              />
            </label>
            <label className="field">
              <span>Artwork darkness threshold · 1–254</span>
              <NumericInput
                data-default-key="traceThreshold"
                aria-label="Artwork darkness threshold"
                integer
                min={1}
                max={254}
                value={importSettings.traceThreshold}
                onChange={(e) => {
                  const n = e;
                  if (Number.isInteger(n) && n >= 1 && n <= 254)
                    onImportChange({ ...importSettings, traceThreshold: n });
                }}
              />
            </label>
            <p className="micro">
              Applies to new SVG/DXF imports across all machines and jobs.
              Existing geometry is unchanged. Lower curve tolerance creates more
              points. Text and images are traced to monochrome outlines; source
              image resolution limits detail.
            </p>
            <button onClick={() => onImportChange(defaultImportSettings())}>
              Restore import defaults
            </button>
          </section>
        </SettingsScope>
        <p>
          Settings are saved for this machine and new jobs. Changes to the
          active job machine are also saved with that job.
        </p>
        <button
          onClick={() => onChange(machine, defaultMachineSettings(machine))}
        >
          Restore machine defaults
        </button>
      </main>
    </SettingsScope>
  );
}

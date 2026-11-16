import { useState } from "react";
import { LengthInput, useDisplayUnits } from "./display-units";
import {
  defaultMachineSettings,
  type MachineSettings,
} from "../core/machine-settings";
export function MachineSettingsEditor({
  active,
  profiles,
  onChange,
}: {
  active: "desktop" | "pro";
  profiles: Partial<Record<"desktop" | "pro", MachineSettings>>;
  onChange: (machine: "desktop" | "pro", settings: MachineSettings) => void;
}) {
  const [machine, setMachine] = useState(active),
    u = useDisplayUnits();
  const current = profiles[machine] ?? defaultMachineSettings(machine);
  const change = (value: Partial<MachineSettings>) =>
    onChange(machine, { ...current, ...value });
  return (
    <main className="workspace machine-settings-page">
      <h1>Machine settings</h1>
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
      <section>
        <h2>Cutting process</h2>
        <label className="field">
          <span>Kerf width - {u.unit}</span>
          <LengthInput
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
          <input
            aria-label="Machine abrasive usage"
            type="number"
            min={0}
            max={10000}
            value={current.abrasive}
            onChange={(e) => {
              const abrasive = e.target.valueAsNumber;
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
        <h2>Maximum cutting area</h2>
        <div className="field-grid">
          <label className="field">
            <span>Width - {u.unit}</span>
            <LengthInput
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
      <p>
        Settings are saved for this machine and new jobs. Changes to the active
        job machine are also saved with that job.
      </p>
      <button
        onClick={() => onChange(machine, defaultMachineSettings(machine))}
      >
        Restore machine defaults
      </button>
    </main>
  );
}

import { useState } from "react";
import { id } from "../core/model";
import {
  jobMaterialSchema,
  type JobMaterial,
  type MaterialLibrary,
} from "../core/job";
export function MaterialsDatabase({
  library,
  onChange,
  onUse,
  onExport,
  onImport,
  onError,
  machine,
}: {
  library: MaterialLibrary;
  onChange: (db: MaterialLibrary) => void;
  onUse: (m: JobMaterial) => void;
  onExport: () => void;
  onImport: () => void;
  onError: (s: string) => void;
  machine: "desktop" | "pro";
}) {
  const [selected, setSelected] = useState(
      library.materials.find((m) => m.machine === machine)?.id ??
        library.materials[0]?.id ??
        "",
    ),
    [search, setSearch] = useState("");
  const current =
    library.materials.find((m) => m.id === selected) ?? library.materials[0];
  const edit = (change: Partial<JobMaterial>) => {
    try {
      const next = jobMaterialSchema.parse({
        ...current,
        ...change,
        preset: undefined,
        source: "User-edited defaults",
      });
      onChange({
        ...library,
        materials: library.materials.map((m) =>
          m.id === current.id ? next : m,
        ),
      });
    } catch (e) {
      onError((e as Error).message);
    }
  };
  if (!current) return <p>No material presets available.</p>;
  return (
    <section>
      <h3>MATERIALS & PRESETS DATABASE</h3>
      <label className="field">
        <span>Search materials</span>
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <label className="field">
        <span>Saved preset</span>
        <select
          value={current.id}
          onChange={(e) => setSelected(e.target.value)}
        >
          {library.materials
            .filter(
              (m) =>
                (m.name + " " + m.thickness)
                  .toLowerCase()
                  .includes(search.toLowerCase()) || m.id === current.id,
            )
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.machine} · {m.name} · {m.thickness} mm
              </option>
            ))}
        </select>
      </label>
      <div className="button-row">
        <button
          onClick={() => {
            const copy = {
              ...structuredClone(current),
              id: id(),
              name: current.name + " copy",
              source: "User defaults",
              preset: undefined,
            };
            onChange({ ...library, materials: [...library.materials, copy] });
            setSelected(copy.id);
          }}
        >
          New / duplicate preset
        </button>
        <button
          disabled={library.materials.length < 2}
          onClick={() =>
            onChange({
              ...library,
              materials: library.materials.filter((m) => m.id !== current.id),
            })
          }
        >
          Delete preset
        </button>
      </div>
      <label className="field">
        <span>Preset name</span>
        <input
          value={current.name}
          onChange={(e) => edit({ name: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Physical stock material</span>
        <input
          value={current.stockKey ?? current.name}
          onChange={(e) => {
            if (e.target.value) edit({ stockKey: e.target.value });
          }}
        />
      </label>
      <p className="micro">
        Presets with the same physical stock name, thickness and machine can
        share a sheet while keeping separate feeds.
      </p>
      <label className="field">
        <span>Preset machine</span>
        <select
          value={current.machine}
          onChange={(e) =>
            edit({ machine: e.target.value as JobMaterial["machine"] })
          }
        >
          <option value="desktop">WAZER Desktop</option>
          <option value="pro">WAZER Pro</option>
        </select>
      </label>
      {(
        [
          ["thickness", "Thickness · mm"],
          ["feed", "Cut feed · mm/min"],
          ["pierce", "Pierce time · s"],
          ["pierceDiameter", "Pierce diameter · mm"],
          ["abrasive", "Abrasive · g/min"],
          ["kerf", "Kerf width · mm"],
          ["tabWidth", "Default tab width · mm"],
          ["tabCount", "Default tab count"],
          ["lead", "Default lead length · mm"],
        ] as const
      ).map(([key, label]) => (
        <label className="field" key={key}>
          <span>{label}</span>
          <input
            type="number"
            aria-label={label}
            min={key === "feed" || key === "thickness" ? 0.001 : 0}
            step={key === "tabCount" ? 1 : 0.01}
            value={current[key] ?? 0}
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v)) edit({ [key]: v });
            }}
          />
        </label>
      ))}
      <p className="micro">
        {current.source}. Pierce diameter must be measured or supplied for the
        process; 0 means unknown.
      </p>
      <button className="primary wide" onClick={() => onUse(current)}>
        Use preset in this job
      </button>
      <p className="micro">
        Database edits are saved as defaults. Existing jobs keep embedded
        snapshots until you explicitly apply a preset.
      </p>
      <div className="button-row">
        <button onClick={onExport}>Export database</button>
        <button onClick={onImport}>Import database</button>
      </div>
    </section>
  );
}

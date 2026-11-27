import { defaultJobMaterial } from "../core/setting-defaults";
import { NumericInput } from "./NumericInput";
import {
  MATERIAL_FAMILIES,
  materialHierarchy,
} from "../core/material-hierarchy";
import { SettingsScope } from "./SettingDefaults";
import { PresetSelector } from "./PresetSelector";
import { materialQuality, materialName } from "../core/material-selection";
import { estimateMaterialSettings } from "../core/material-estimate";
import { deleteMaterialPreset } from "../core/material-library";
import { LengthInput, useDisplayUnits } from "./display-units";
import { gaugesFor } from "../core/material-gauges";
import { useState, useEffect } from "react";
import { id } from "../core/model";
import { Save } from "lucide-react";
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
  initialId,
  onSave,
}: {
  initialId?: string;
  onSave?: () => Promise<void>;
  library: MaterialLibrary;
  onChange: (db: MaterialLibrary) => void;
  onUse: (m: JobMaterial) => void;
  onExport: () => void;
  onImport: () => void;
  onError: (s: string) => void;
  machine: "desktop" | "pro";
}) {
  const units = useDisplayUnits();
  const [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [library]);
  const [selected, setSelected] = useState(
    (initialId && library.materials.some((m) => m.id === initialId)
      ? initialId
      : defaultJobMaterial(library, machine)?.id) ??
      library.materials.find((m) => m.machine === machine)?.id ??
      library.materials[0]?.id ??
      "",
  );
  const current =
    library.materials.find((m) => m.id === selected) ?? library.materials[0];
  const edit = (change: Partial<JobMaterial>) => {
    try {
      const next = jobMaterialSchema.parse({
        ...current,
        quality: materialQuality(current),
        ...change,
        preset: undefined,
        source: current.source?.startsWith("User-edited defaults")
          ? current.source
          : `User-edited defaults${current.source ? `; based on ${current.source}` : ""}`,
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
  const organization = materialHierarchy(current);
  const editOrganization = (
    change: Partial<ReturnType<typeof materialHierarchy>>,
  ) =>
    onChange({
      ...library,
      materials: library.materials.map((m) =>
        materialName(m) === materialName(current)
          ? { ...m, ...change, organizationRevision: Date.now() }
          : m,
      ),
    });
  return (
    <SettingsScope
      title={`${current.name} · ${units.length(current.thickness)} · ${current.machine}`}
      prefix="process."
      material={current}
      values={current}
      fallbacks={current}
      onRevert={(key, v) => edit({ [key]: v })}
    >
      <section className="materials-database">
        <h3>PRESETS</h3>
        <PresetSelector
          labelSuffix="preset database"
          records={library.materials}
          current={current}
          machine={current.machine}
          allMachines
          onChange={(m) => setSelected(m.id)}
        />
        <div className="button-row">
          {onSave && (
            <button
              className="primary"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setSaved(false);
                try {
                  await onSave();
                  setSaved(true);
                } catch (error) {
                  onError(
                    "Could not save presets: " + (error as Error).message,
                  );
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Save size={15} />
              {saving ? "Saving…" : "Save presets"}
            </button>
          )}
          {saved && <span role="status">Presets saved</span>}
          <button
            onClick={() => {
              const copy = {
                ...structuredClone(current),
                id: id(),
                name: current.name + " copy",
                source: "User defaults",
                quality: materialQuality(current),
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
            onClick={() => onChange(deleteMaterialPreset(library, current.id))}
          >
            Delete preset
          </button>
        </div>
        <details className="material-organization">
          <summary>Organization</summary>
          <label className="field">
            <span>Material family</span>
            <select
              aria-label="Preset material family"
              value={organization.family}
              onChange={(e) =>
                editOrganization({
                  family: e.target.value as typeof organization.family,
                })
              }
            >
              {MATERIAL_FAMILIES.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Material class</span>
            <input
              aria-label="Preset material class"
              value={organization.materialClass}
              onChange={(e) =>
                editOrganization({ materialClass: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Alloy / material</span>
            <input
              aria-label="Preset material grade"
              value={organization.grade}
              onChange={(e) => editOrganization({ grade: e.target.value })}
            />
          </label>
        </details>
        <label className="field">
          <span>Preset name</span>
          <input
            value={current.name}
            onChange={(e) => edit({ name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Profile quality</span>
          <select
            value={materialQuality(current)}
            onChange={(e) =>
              edit({
                quality: e.target.value as
                  "coarse" | "medium" | "fine" | "custom",
              })
            }
          >
            <option value="coarse">Coarse</option>
            <option value="medium">Medium</option>
            <option value="fine">Fine</option>
            <option value="custom">Custom</option>
          </select>
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
        {gaugesFor(current.stockKey ?? current.name).length > 0 && (
          <label className="field">
            <span>Standard gauge</span>
            <select
              value={
                gaugesFor(current.stockKey ?? current.name).find(
                  (g) => Math.abs(g.mm - current.thickness) < 0.00001,
                )?.gauge ?? "custom"
              }
              onChange={(e) => {
                const g = gaugesFor(current.stockKey ?? current.name).find(
                  (g) => g.gauge === Number(e.target.value),
                );
                if (g) edit({ thickness: g.mm, requiresVerification: true });
              }}
            >
              <option value="custom">Custom thickness</option>
              {gaugesFor(current.stockKey ?? current.name).map((g) => (
                <option key={g.gauge} value={g.gauge}>
                  {g.gauge} Ga - {units.length(g.mm)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          onClick={() => {
            try {
              const quality = materialQuality(current);
              const calculated = estimateMaterialSettings(
                current,
                current.thickness,
                quality === "custom" ? "medium" : quality,
              );
              onChange({
                ...library,
                materials: library.materials.map((m) =>
                  m.id === current.id ? calculated : m,
                ),
              });
            } catch (error) {
              onError(
                (error as Error).message
                  .replace(/WAM/g, "preset")
                  .replace(/references/gi, "data"),
              );
            }
          }}
        >
          Calculate settings
        </button>
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
            ["leadInOverlap", "Lead-in overlap · mm"],
            ["leadOutOverlap", "Lead-out overlap · mm"],
          ] as const
        ).map(([key, label]) => (
          <label className="field" key={key}>
            <span>{label.replace("mm", units.unit)}</span>
            {[
              "thickness",
              "feed",
              "pierceDiameter",
              "kerf",
              "tabWidth",
              "lead",
              "leadInOverlap",
              "leadOutOverlap",
            ].includes(key) ? (
              <LengthInput
                data-default-key={key}
                rate={key === "feed"}
                aria-label={label.replace("mm", units.unit)}
                min={key === "feed" || key === "thickness" ? 0.001 : 0}
                value={current[key] ?? 0}
                onChange={(v) => edit({ [key]: v })}
              />
            ) : (
              <NumericInput
                data-default-key={key}
                integer={key === "tabCount"}
                unit={
                  key === "pierce"
                    ? "s"
                    : key === "abrasive"
                      ? "g/min"
                      : undefined
                }
                aria-label={label}
                min={0}
                step={key === "tabCount" ? 1 : 0.01}
                value={current[key] ?? 0}
                onChange={(e) => {
                  const v = e;
                  if (Number.isFinite(v)) edit({ [key]: v });
                }}
              />
            )}
          </label>
        ))}
        <button className="primary wide" onClick={() => onUse(current)}>
          Use preset in this job
        </button>
        <div className="button-row">
          <button onClick={onExport}>Export database</button>
          <button onClick={onImport}>Import database</button>
        </div>
      </section>
    </SettingsScope>
  );
}

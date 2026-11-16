import type { JobMaterial } from "../core/job";
import {
  materialCatalog,
  materialName,
  materialQuality,
  qualityLabel,
  qualityProfiles,
  selectMaterialProfile,
  thicknessKey,
  thicknessLabel,
} from "../core/material-selection";
import { useDisplayUnits } from "./display-units";
export function PresetSelector({
  records,
  current,
  machine,
  onChange,
  labelSuffix = "",
  row = false,
  showQuality = true,
  allMachines = false,
}: {
  records: JobMaterial[];
  current: JobMaterial;
  machine: JobMaterial["machine"];
  onChange: (m: JobMaterial) => void;
  labelSuffix?: string;
  row?: boolean;
  showQuality?: boolean;
  allMachines?: boolean;
}) {
  const u = useDisplayUnits(),
    items = materialCatalog(records, current),
    name = materialName(current);
  const names = [...new Set(items.map(materialName))].sort((a, b) =>
    a.localeCompare(b),
  );
  const thicknesses = items
    .filter((m) => materialName(m) === name)
    .filter(
      (m, i, a) =>
        a.findIndex(
          (x) => thicknessKey(x.thickness) === thicknessKey(m.thickness),
        ) === i,
    )
    .sort((a, b) => a.thickness - b.thickness);
  const qualities = qualityProfiles(items, current, machine, allMachines);
  const select = (m: JobMaterial) =>
    onChange({ ...m, stockKey: materialName(m), quality: materialQuality(m) });
  const fields = [
    {
      label: "Material",
      control: (
        <select
          aria-label={`Material${labelSuffix ? " " + labelSuffix : ""}`}
          value={name}
          onChange={(e) =>
            select(
              selectMaterialProfile(items, current, machine, e.target.value),
            )
          }
        >
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      ),
    },
    {
      label: "Thickness",
      control: (
        <select
          aria-label={`Thickness${labelSuffix ? " " + labelSuffix : ""}`}
          value={thicknessKey(current.thickness)}
          onChange={(e) =>
            select(
              selectMaterialProfile(
                items,
                current,
                machine,
                name,
                Number(e.target.value),
              ),
            )
          }
        >
          {thicknesses.map((m) => (
            <option
              key={thicknessKey(m.thickness)}
              value={thicknessKey(m.thickness)}
            >
              {thicknessLabel(m, u.unit)}
            </option>
          ))}
        </select>
      ),
    },
    ...(showQuality
      ? [
          {
            label: "Quality",
            control: (
              <select
                aria-label={`Quality${labelSuffix ? " " + labelSuffix : ""}`}
                value={current.id}
                onChange={(e) =>
                  select(items.find((m) => m.id === e.target.value)!)
                }
              >
                {qualities.map((m) => (
                  <option key={m.id} value={m.id}>
                    {qualityLabel(m)}
                    {allMachines ? ` - ${m.machine}` : ""}
                    {m.requiresVerification ? " - Needs settings" : ""}
                    {qualities.filter(
                      (x) => materialQuality(x) === materialQuality(m),
                    ).length > 1
                      ? ` - ${m.name}`
                      : ""}
                  </option>
                ))}
              </select>
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      {fields.map((f) =>
        row ? (
          <span className="preset-select-cell" key={f.label}>
            {f.control}
          </span>
        ) : (
          <label className="field" key={f.label}>
            <span>{f.label}</span>
            {f.control}
          </label>
        ),
      )}
    </>
  );
}

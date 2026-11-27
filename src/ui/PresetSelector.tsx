import {
  MATERIAL_FAMILIES,
  materialHierarchy,
} from "../core/material-hierarchy";
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
    items = materialCatalog(records, current).filter(
      (m) => m.id === current.id || allMachines || m.machine === machine,
    ),
    name = materialName(current);
  const organized=new Map<string,JobMaterial>();
  for(const record of records) if(record.family!==undefined||record.materialClass!==undefined||record.grade!==undefined) {
    const key=materialName(record),old=organized.get(key);
    if(!old||(record.organizationRevision??0)>=(old.organizationRevision??0))organized.set(key,record);
  }
  const hierarchyOf=(m:JobMaterial)=>materialHierarchy(organized.get(materialName(m))??m);
  const hierarchy = hierarchyOf(current);
  const stockItems = [
    ...new Map(items.map((m) => [materialName(m), m])).values(),
  ];
  const byFamily = stockItems.filter(
    (m) => hierarchyOf(m).family === hierarchy.family,
  );
  const classes = [
    ...new Set(byFamily.map((m) => hierarchyOf(m).materialClass)),
  ].sort((a, b) => a.localeCompare(b));
  const names = byFamily
    .filter(
      (m) => hierarchyOf(m).materialClass === hierarchy.materialClass,
    )
    .map(materialName)
    .sort((a, b) => a.localeCompare(b));
  const chooseGroup = (family: string, materialClass?: string) => {
    const candidates = stockItems
      .filter(
        (m) =>
          hierarchyOf(m).family === family &&
          (materialClass === undefined ||
            hierarchyOf(m).materialClass === materialClass),
      )
      .sort((a, b) => materialName(a).localeCompare(materialName(b)));
    if (candidates.length)
      select(
        selectMaterialProfile(
          items,
          current,
          machine,
          materialName(candidates[0]),
        ),
      );
  };

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
      label: "Family",
      control: (
        <select
          aria-label={`Material family${labelSuffix ? " " + labelSuffix : ""}`}
          value={hierarchy.family}
          onChange={(e) => chooseGroup(e.target.value)}
        >
          {MATERIAL_FAMILIES.map((f) => (
            <option
              key={f}
              value={f}
              disabled={
                !stockItems.some((m) => hierarchyOf(m).family === f)
              }
            >
              {f}
            </option>
          ))}
        </select>
      ),
    },
    ...(classes.some((c) => c !== "")
      ? [
          {
            label: "Class",
            control: (
              <select
                aria-label={`Material class${labelSuffix ? " " + labelSuffix : ""}`}
                value={hierarchy.materialClass}
                onChange={(e) => chooseGroup(hierarchy.family, e.target.value)}
              >
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {c || "Unclassified"}
                  </option>
                ))}
              </select>
            ),
          },
        ]
      : []),
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
              {
                materialHierarchy(
                  stockItems.find((m) => materialName(m) === n)!,
                ).grade
              }
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
                    {qualities.some(x=>x.id!==m.id&&materialQuality(x)===materialQuality(m)&&x.machine===m.machine)
                      ? ` · ${u.number(m.feed)} ${u.unit}/min · ${m.pierce} s · ${u.number(m.lead)} ${u.unit}`
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

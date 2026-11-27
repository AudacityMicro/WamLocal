import { Plus, Pencil } from "lucide-react";
import { NumericInput } from "./NumericInput";
import {
  defaultJobMaterial,
  matchingDefaultMaterial,
} from "../core/setting-defaults";
import { SettingsScope } from "./SettingDefaults";
import type { Job, JobMaterial, MaterialLibrary } from "../core/job";
import { jobSchema } from "../core/job";
import { setJobMaterial } from "../core/job-ops";
import { defaultTabWidth } from "../core/tab-defaults";
import { AreaInput, LengthInput, useDisplayUnits } from "./display-units";
import { PresetSelector } from "./PresetSelector";
import { WorkOriginPicker } from "./WorkOriginPicker";
export function JobSettings({
  job,
  materials,
  library,
  onChange,
  onMaterialEdit,
}: {
  job: Job;
  materials: JobMaterial[];
  library: MaterialLibrary;
  onChange: (job: Job) => void;
  onMaterialEdit?: (mode: "new" | "edit", material: JobMaterial) => void;
}) {
  const u = useDisplayUnits(),
    sheet = job.sheets[0];
  const material = job.materials.find((m) => m.id === sheet.materialId)!;
  const tabs: NonNullable<Job["tabRules"]> = job.tabRules ?? {
    width: defaultTabWidth(material.thickness),
    count: 2,
    automaticWidth: true,
    minHoleArea: 0,
  };
  const updateTabs = (change: Partial<typeof tabs>) =>
    onChange(
      jobSchema.parse({
        ...job,
        sharedSetup: true,
        tabRules: { ...tabs, ...change },
      }),
    );
  return (
    <>
      <SettingsScope
        title="Job defaults"
        values={{
          [`job.materialId.${job.machine}`]:
            matchingDefaultMaterial(library, material)?.id ?? material.id,
          ...Object.fromEntries(
            Object.entries(sheet.stock).map(([k, v]) => [`stock.${k}`, v]),
          ),
          "job.workOrigin": sheet.workOrigin ?? "top-left",
          "job.workOriginReference": sheet.workOriginReference ?? "sheet",
        }}
        fallbacks={{
          "stock.width": 460,
          "stock.height": 305,
          "stock.margin": 8,
          "stock.spacing": 4,
          "job.workOrigin": "top-left",
          "job.workOriginReference": "sheet",
          [`job.materialId.${job.machine}`]:
            defaultJobMaterial(library, job.machine)?.id ?? material.id,
        }}
        onRevert={(key, v) =>
          key.startsWith("job.materialId.")
            ? onChange(
                setJobMaterial(
                  job,
                  library.materials.find((m) => m.id === v) ??
                    materials.find((m) => m.id === v)!,
                ),
              )
            : onChange(
                jobSchema.parse({
                  ...job,
                  sheets: job.sheets.map((s) => ({
                    ...s,
                    ...(key === "job.workOrigin"
                      ? { workOrigin: v }
                      : key === "job.workOriginReference"
                        ? { workOriginReference: v }
                        : { stock: { ...s.stock, [key.slice(6)]: v } }),
                  })),
                }),
              )
        }
      >
        <details className="job-nesting-options" open>
          <summary>Material &amp; sheets</summary>
          <div
            className="job-material-selection-row"
            data-default-key={`job.materialId.${job.machine}`}
          >
            <PresetSelector
              labelSuffix="job"
              records={materials}
              current={material}
              machine={job.machine}
              onChange={(m) =>
                onChange(
                  setJobMaterial(job, matchingDefaultMaterial(library, m) ?? m),
                )
              }
            />
            {onMaterialEdit && (
              <div className="button-row job-material-actions">
                <button
                  title="New material"
                  aria-label="New material from job"
                  onClick={() => onMaterialEdit("new", material)}
                >
                  <Plus size={16} />
                </button>
                <button
                  title="Edit material preset"
                  aria-label="Edit material from job"
                  onClick={() => onMaterialEdit("edit", material)}
                >
                  <Pencil size={16} />
                </button>
              </div>
            )}
          </div>
          <div className="field-grid">
            {(["width", "height", "margin", "spacing"] as const).map((key) => (
              <label className="field" key={key}>
                <span>
                  {
                    {
                      width: "Sheet width",
                      height: "Sheet height",
                      margin: "Edge margin",
                      spacing: "Part spacing",
                    }[key]
                  }{" "}
                  · {u.unit}
                </span>
                <LengthInput
                  data-default-key={`stock.${key}`}
                  aria-label={`Job ${key}`}
                  value={sheet.stock[key]}
                  min={key === "width" || key === "height" ? 1 : 0}
                  max={key === "width" ? 460 : key === "height" ? 305 : 100}
                  onChange={(value) =>
                    onChange(
                      jobSchema.parse({
                        ...job,
                        sharedSetup: true,
                        sheets: job.sheets.map((s) => ({
                          ...s,
                          stock: { ...s.stock, [key]: value },
                        })),
                      }),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <label className="field">
            <span>WCS reference</span>
            <select
              aria-label="WCS reference"
              data-default-key="job.workOriginReference"
              value={sheet.workOriginReference ?? "sheet"}
              onChange={(e) =>
                onChange(
                  jobSchema.parse({
                    ...job,
                    sheets: job.sheets.map((s) => ({
                      ...s,
                      workOriginReference: e.target.value,
                    })),
                  }),
                )
              }
            >
              <option value="sheet">Sheet</option>
              <option value="parts">Parts bounding box</option>
            </select>
          </label>
          {sheet.workOriginReference === "parts" && (
            <p className="micro">
              Uses the combined outline bounds of all placed parts on each
              sheet, before kerf and leads. With no placed parts, the origin
              uses the sheet.
            </p>
          )}
          <div data-default-key="job.workOrigin">
            <WorkOriginPicker
              label={
                sheet.workOriginReference === "parts"
                  ? "Job parts WCS origin"
                  : "Job sheet WCS origin"
              }
              value={sheet.workOrigin}
              onChange={(workOrigin) =>
                onChange(
                  jobSchema.parse({
                    ...job,
                    sharedSetup: true,
                    sheets: job.sheets.map((s) => ({ ...s, workOrigin })),
                  }),
                )
              }
            />
          </div>
          <p className="micro">
            Every part and sheet in this job uses this material and thickness.
            New sheets use the same size, spacing and origin.
          </p>
        </details>
      </SettingsScope>
      <SettingsScope
        title={`${material.name} · ${u.length(material.thickness)} · ${material.machine} · ${material.quality ?? "custom"}`}
        material={material}
        prefix="tabs."
        values={tabs}
        fallbacks={{
          width: defaultTabWidth(material.thickness),
          count: 2,
          automaticWidth: true,
          minHoleArea: 0,
          maxPartArea: null,
        }}
        onRevert={(key, v) =>
          updateTabs({
            [key]: v === null ? undefined : v,
            ...(key === "width"
              ? {
                  automaticWidth:
                    material.settingDefaults?.["tabs.width"] === undefined,
                }
              : {}),
          })
        }
      >
        <details className="job-nesting-options" open>
          <summary>Tabs &amp; lead-ins</summary>
          <SettingsScope
            title={`${material.name} · lead-in defaults`}
            material={material}
            values={{
              lead: material.lead,
              leadInOverlap: material.leadInOverlap ?? 0,
              leadOutOverlap: material.leadOutOverlap ?? 0,
              leadStyle: material.leadStyle ?? "arc",
            }}
            fallbacks={{
              lead: 2,
              leadStyle: "arc",
              leadInOverlap: 0,
              leadOutOverlap: 0,
            }}
            onRevert={(key, value) =>
              onChange(
                jobSchema.parse({
                  ...job,
                  materials: job.materials.map((m) =>
                    m.id === material.id ? { ...m, [key]: value } : m,
                  ),
                }),
              )
            }
          >
            <div className="field-grid">
              <label className="field">
                <span>Lead-in length · {u.unit}</span>
                <LengthInput
                  data-default-key="lead"
                  aria-label="Job lead-in length"
                  value={material.lead}
                  min={0}
                  max={30}
                  onChange={(lead) =>
                    onChange(
                      jobSchema.parse({
                        ...job,
                        materials: job.materials.map((m) =>
                          m.id === material.id ? { ...m, lead } : m,
                        ),
                      }),
                    )
                  }
                />
              </label>
              {(["leadInOverlap", "leadOutOverlap"] as const).map((key) => (
                <label className="field" key={key}>
                  <span>
                    {key === "leadInOverlap"
                      ? "Lead-in overlap"
                      : "Lead-out overlap"}{" "}
                    · {u.unit}
                  </span>
                  <LengthInput
                    data-default-key={key}
                    aria-label={
                      key === "leadInOverlap"
                        ? "Job lead-in overlap"
                        : "Job lead-out overlap"
                    }
                    value={material[key] ?? 0}
                    min={0}
                    max={30}
                    onChange={(value) =>
                      onChange(
                        jobSchema.parse({
                          ...job,
                          materials: job.materials.map((m) =>
                            m.id === material.id ? { ...m, [key]: value } : m,
                          ),
                        }),
                      )
                    }
                  />
                </label>
              ))}
              <label className="field">
                <span>Lead-in shape</span>
                <select
                  data-default-key="leadStyle"
                  aria-label="Job lead-in shape"
                  value={material.leadStyle ?? "arc"}
                  onChange={(e) =>
                    onChange(
                      jobSchema.parse({
                        ...job,
                        materials: job.materials.map((m) =>
                          m.id === material.id
                            ? { ...m, leadStyle: e.target.value }
                            : m,
                        ),
                      }),
                    )
                  }
                >
                  <option value="arc">Tangent arc</option>
                  <option value="straight">Straight</option>
                </select>
              </label>
            </div>
            <p className="micro">
              Lead-ins apply with or without tabs. Set length to zero to
              disable. Overlap extends cutting along closed profiles before and
              after the entry point; it stops at tabs. Contour overrides are set
              in the part editor.
            </p>
          </SettingsScope>
          <div className="field-grid">
            <label className="field">
              <span>Tab width · {u.unit}</span>
              <LengthInput
                data-default-key="width"
                aria-label="Job tab width"
                value={tabs.width}
                min={0}
                max={20}
                step={0.0254}
                onChange={(width) =>
                  updateTabs({ width, automaticWidth: false })
                }
              />
            </label>
            <label className="field">
              <span>Tabs per contour</span>
              <NumericInput
                data-default-key="count"
                aria-label="Job tab count"
                integer

                min={0}
                max={20}
                value={tabs.count}
                onChange={(e) => {
                  const count = e;
                  if (Number.isInteger(count) && count >= 0 && count <= 20)
                    updateTabs({ count });
                }}
              />
            </label>
            <label className="field">
              <span>Minimum hole area for tabs · {u.areaUnit}</span>
              <AreaInput
                data-default-key="minHoleArea"
                aria-label="Minimum hole area for tabs"
                value={tabs.minHoleArea}
                onChange={(minHoleArea) => updateTabs({ minHoleArea })}
              />
            </label>
            <label className="field">
              <span>Maximum part area for tabs · {u.areaUnit}</span>
              <AreaInput
                data-default-key="maxPartArea"
                aria-label="Maximum part area for tabs"
                disabled={tabs.maxPartArea === undefined}
                value={tabs.maxPartArea ?? 0}
                onChange={(maxPartArea) => {
                  if (maxPartArea > 0) updateTabs({ maxPartArea });
                }}
              />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              data-default-key="maxPartArea"
              checked={tabs.maxPartArea !== undefined}
              onChange={(e) =>
                updateTabs({
                  maxPartArea: e.target.checked
                    ? sheet.stock.width * sheet.stock.height
                    : undefined,
                })
              }
            />
            Limit automatic tabs by part area
          </label>
          <p className="micro">
            Small holes below the minimum and parts above the maximum get no
            automatic tabs. Part area is the outer area minus holes, at placed
            scale. Equality includes tabs. Zero minimum includes all holes.
            Manual tabs remain explicit overrides in the part editor.
          </p>
          <p className="micro">
            Default widths decrease with thickness, from {u.length(1.016)} to{" "}
            {u.length(0.254)}. These are starting values, not limits; custom
            widths may be smaller or larger. Width is the minimum finished
            bridge. Kerf and tangent-arc clearance are added automatically, so
            the gap on the profile may be wider.
          </p>
        </details>
      </SettingsScope>
    </>
  );
}

import type { ReactNode } from "react";
import type { Sheet } from "../core/job";
import { PresetSelector } from "./PresetSelector";
import { materialForMachine } from "../core/material-gauges";
import { WorkOriginPicker } from "./WorkOriginPicker";
import { originLabel } from "../core/work-origin";
import { LengthInput, useDisplayUnits } from "./display-units";
import type { JobMaterial } from "../core/job";
import { id } from "../core/model";
import {
  materialsCompatible,
  placedCount,
  type Job,
  type JobView,
} from "../core/job";
import {
  placeDefinition,
  setPartMaterial,
  setPartQuantity,
} from "../core/job-ops";
export function JobPanel({
  renderPreview,
  presets,
  sheetsOnly = false,
  job,
  view,
  onChange,
  onSelectSheet,
  onOpen,
  onNewPart,
  onUpload,
  onNest,
  onError,
}: {
  renderPreview?: (sheet: Sheet) => ReactNode;
  presets?: JobMaterial[];
  sheetsOnly?: boolean;
  job: Job;
  view: JobView;
  onChange: (job: Job) => void;
  onSelectSheet?: (id: string) => void;
  onOpen: (view: JobView) => void;
  onNewPart: () => void;
  onUpload: () => void;
  onNest: () => void;
  onError: (message: string) => void;
}) {
  const units = useDisplayUnits();
  const act = (fn: () => Job) => {
    try {
      onChange(fn());
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const active = job.sheets.find((s) => s.id === view.id) ?? job.sheets[0];
  return (
    <>
      {!sheetsOnly && (
        <>
          <section>
            <h3>JOB</h3>
            <label className="field">
              <span>Job machine</span>
              <select
                value={job.machine}
                onChange={(e) =>
                  onChange({
                    ...job,
                    machine: e.target.value as Job["machine"],
                  })
                }
              >
                <option value="desktop">WAZER Desktop</option>
                <option value="pro">WAZER Pro</option>
              </select>
            </label>
            <label className="field">
              <span>Job name</span>
              <input
                value={job.name}
                onChange={(e) => {
                  if (e.target.value)
                    onChange({ ...job, name: e.target.value });
                }}
              />
            </label>
            <div className="button-row">
              <button onClick={onUpload}>Upload parts</button>
              <button onClick={onNewPart}>New part</button>
            </div>
            <button className="primary wide job-nest" onClick={onNest}>
              Nest job across sheets
            </button>
            <p className="micro">
              SVGnest places requested quantities by material. Additional sheets
              are created as needed.
            </p>
          </section>
          <section>
            <h3>PART LIBRARY · {job.parts.length}</h3>
            {job.parts.map((p) => (
              <div
                className={`job-card ${view.kind === "part" && view.id === p.id ? "active" : ""}`}
                key={p.id}
              >
                <button
                  className="job-item"
                  onClick={() => onOpen({ kind: "part", id: p.id })}
                >
                  {p.name}
                </button>
                <p className="micro">
                  {placedCount(job, p.id)} placed / {p.quantity} requested ·{" "}
                  {p.contours.length} contours
                </p>
                <label className="field">
                  <span>Quantity · {p.name}</span>
                  <input
                    aria-label={`Quantity ${p.name}`}
                    type="number"
                    min="1"
                    max="2000"
                    value={p.quantity}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber;
                      if (Number.isInteger(n) && n > 0 && n <= 2000)
                        act(() => setPartQuantity(job, p.id, n));
                    }}
                  />
                </label>
                <label className="field">
                  <span>Part material · {p.name}</span>
                  <select
                    value={p.materialId}
                    onChange={(e) =>
                      act(() => setPartMaterial(job, p.id, e.target.value))
                    }
                  >
                    {job.materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {m.thickness} mm
                      </option>
                    ))}
                  </select>
                </label>
                <div className="button-row">
                  <button onClick={() => onOpen({ kind: "part", id: p.id })}>
                    Edit part
                  </button>
                  <button
                    disabled={
                      !p.contours.length || placedCount(job, p.id) >= p.quantity
                    }
                    onClick={() =>
                      act(() => placeDefinition(job, p.id, active.id))
                    }
                  >
                    Place on {active.name}
                  </button>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    act(() => ({
                      ...job,
                      parts: job.parts.filter((d) => d.id !== p.id),
                      sheets: job.sheets.map((s) => ({
                        ...s,
                        placements: s.placements.filter(
                          (i) => i.partId !== p.id,
                        ),
                      })),
                    }))
                  }
                >
                  Remove part from job
                </button>
              </div>
            ))}
            {!job.parts.length ? (
              <p className="muted">
                Upload geometry or create a new part, then assign material and
                quantity.
              </p>
            ) : null}
          </section>
        </>
      )}
      <section>
        <h3>SHEETS · {job.sheets.length}</h3>
        {job.sheets.map((s) => (
          <div
            className={`job-card ${renderPreview ? "sheet-with-preview" : ""} ${view.kind === "sheet" && view.id === s.id ? "active" : ""}`}
            key={s.id}
          >
            <div className="sheet-details">
              <button
                className="job-item"
                onClick={() =>
                  onSelectSheet
                    ? onSelectSheet(s.id)
                    : onOpen({ kind: "sheet", id: s.id })
                }
              >
                {s.name}
              </button>
              <p className="micro">
                {units.number(s.stock.width)} × {units.number(s.stock.height)}{" "}
                {units.unit} · {s.placements.length} parts · Origin{" "}
                {originLabel(s.workOrigin ?? "top-left")}
              </p>
              <label className="field">
                <span>Sheet name</span>
                <input
                  value={s.name}
                  onChange={(e) => {
                    if (e.target.value)
                      onChange({
                        ...job,
                        sheets: job.sheets.map((a) =>
                          a.id === s.id ? { ...a, name: e.target.value } : a,
                        ),
                      });
                  }}
                />
              </label>
              <div className="field-grid">
                {(
                  [
                    ["width", "Width - mm", 460],
                    ["height", "Height - mm", 305],
                  ] as const
                ).map(([key, label, max]) => (
                  <label className="field" key={key}>
                    <span>
                      {key === "width" ? "Width" : "Height"} - {units.unit}
                    </span>
                    <LengthInput
                      aria-label={`${s.name} ${key}`}
                      min={1}
                      max={max}
                      value={s.stock[key]}
                      onChange={(n) =>
                        onChange({
                          ...job,
                          sheets: job.sheets.map((a) =>
                            a.id === s.id
                              ? { ...a, stock: { ...a.stock, [key]: n } }
                              : a,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              {renderPreview && (
                <div className="field-grid">
                  {(["margin", "spacing"] as const).map((key) => (
                    <label className="field" key={key}>
                      <span>
                        {key === "margin" ? "Edge margin" : "Part spacing"} -{" "}
                        {units.unit}
                      </span>
                      <LengthInput
                        aria-label={`${s.name} ${key}`}
                        value={s.stock[key]}
                        min={0}
                        max={100}
                        onChange={(n) =>
                          onChange({
                            ...job,
                            sheets: job.sheets.map((a) =>
                              a.id === s.id
                                ? { ...a, stock: { ...a.stock, [key]: n } }
                                : a,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
              <WorkOriginPicker
                label={`${s.name} WCS origin`}
                value={s.workOrigin}
                onChange={(anchor) =>
                  onChange({
                    ...job,
                    sheets: job.sheets.map((a) =>
                      a.id === s.id ? { ...a, workOrigin: anchor } : a,
                    ),
                  })
                }
              />
              <PresetSelector
                showQuality={false}
                labelSuffix={s.name}
                records={presets ?? job.materials}
                current={job.materials.find((m) => m.id === s.materialId)!}
                machine={job.machine}
                onChange={(selected) => {
                  const record = materialForMachine(selected, job.machine);
                  const nextMaterials = job.materials.some(
                    (m) => m.id === record.id,
                  )
                    ? job.materials
                    : [...job.materials, record];
                  onChange({
                    ...job,
                    materials: nextMaterials,
                    sheets: job.sheets.map((a) =>
                      a.id === s.id
                        ? {
                            ...a,
                            materialId: record.id,
                            placements: a.placements.filter((i) => {
                              const p = job.parts.find(
                                (p) => p.id === i.partId,
                              )!;
                              const old = job.materials.find(
                                (m) => m.id === p.materialId,
                              )!;
                              return materialsCompatible(old, record);
                            }),
                          }
                        : a,
                    ),
                  });
                }}
              />
              <div className="button-row">
                {!renderPreview && (
                  <button onClick={() => onOpen({ kind: "sheet", id: s.id })}>
                    Open sheet
                  </button>
                )}
                <button
                  disabled={job.sheets.length === 1}
                  onClick={() =>
                    onChange({
                      ...job,
                      sheets: job.sheets.filter((a) => a.id !== s.id),
                    })
                  }
                >
                  Remove sheet
                </button>
              </div>
            </div>
            {renderPreview?.(s)}
          </div>
        ))}
        <button
          className="wide"
          onClick={() =>
            onChange({
              ...job,
              sheets: [
                ...job.sheets,
                {
                  ...structuredClone(active),
                  id: id(),
                  name: `Sheet ${job.sheets.length + 1}`,
                  placements: [],
                },
              ],
            })
          }
        >
          Add sheet
        </button>
        {renderPreview &&
          job.sheets.length > 1 &&
          job.sheets.some((s) => !s.placements.length) && (
            <button
              className="wide"
              onClick={() => {
                const used = job.sheets.filter((s) => s.placements.length);
                onChange({
                  ...job,
                  sheets: used.length ? used : [job.sheets[0]],
                });
              }}
            >
              Remove empty sheets
            </button>
          )}
        <p className="micro">
          Removing a sheet or changing its material returns affected copies to
          the unplaced quantity.
        </p>
      </section>
    </>
  );
}

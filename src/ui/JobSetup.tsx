import { useState } from "react";
import {
  placedCount,
  type Job,
  type JobView,
  type MaterialLibrary,
} from "../core/job";
import { setPartMaterial, setPartQuantity } from "../core/job-ops";

export function JobSetup({
  job,
  library,
  onChange,
  onOpen,
  onUpload,
  onNewPart,
  onNest,
}: {
  job: Job;
  library: MaterialLibrary;
  onChange: (job: Job) => void;
  onOpen: (view: JobView) => void;
  onUpload: () => void;
  onNewPart: () => void;
  onNest: () => void;
}) {
  const [selected, select] = useState<string>();
  const part = job.parts.find((p) => p.id === selected) ?? job.parts[0];
  const material = job.materials.find((m) => m.id === part?.materialId);
  const materials = [
    ...job.materials,
    ...library.materials.filter(
      (m) =>
        m.machine === job.machine && !job.materials.some((a) => a.id === m.id),
    ),
  ];
  const updatePart = (change: Partial<NonNullable<typeof part>>) =>
    onChange({
      ...job,
      parts: job.parts.map((p) => (p.id === part.id ? { ...p, ...change } : p)),
    });
  const process = (
    key: "lead" | "pierce" | "pierceDiameter" | "feed" | "kerf",
    value: number,
  ) => {
    if (
      !material ||
      !Number.isFinite(value) ||
      value < 0 ||
      (key === "feed" && value === 0)
    )
      return;
    // Each part gets a private process profile; physical stock identity is preserved.
    const privateId = `part-process-${part.id}`;
    const record = {
      ...material,
      id: privateId,
      stockKey: material.stockKey ?? material.name,
      [key]: value,
      preset: undefined,
    };
    const next = {
      ...job,
      materials: [...job.materials.filter((m) => m.id !== privateId), record],
    };
    onChange(setPartMaterial(next, part.id, privateId));
  };
  return (
    <main className="job-setup">
      <header className="setup-heading">
        <div>
          <span className="eyebrow">JOB SETUP</span>
          <h1>{job.name}</h1>
        </div>
        <div className="button-row">
          <button onClick={onUpload}>Upload parts</button>
          <button onClick={onNewPart}>New part</button>
          <button
            className="primary"
            onClick={onNest}
            disabled={!job.parts.length}
          >
            Nest job
          </button>
        </div>
      </header>
      <div className="setup-job-fields">
        <label className="field">
          <span>Job name</span>
          <input
            value={job.name}
            onChange={(e) =>
              e.target.value && onChange({ ...job, name: e.target.value })
            }
          />
        </label>
        <label className="field">
          <span>Machine</span>
          <select
            value={job.machine}
            onChange={(e) =>
              onChange({ ...job, machine: e.target.value as Job["machine"] })
            }
          >
            <option value="desktop">WAZER Desktop</option>
            <option value="pro">WAZER Pro</option>
          </select>
        </label>
      </div>
      <div className="setup-columns">
        <section className="setup-parts">
          <div className="setup-section-heading">
            <h2>Parts</h2>
            <span>
              {job.parts.length} parts · {job.sheets.length} sheets
            </span>
          </div>
          <div className="setup-table">
            <div className="setup-row setup-labels">
              <span>Part</span>
              <span>Quantity</span>
              <span>Material</span>
              <span>Placed</span>
            </div>
            {job.parts.map((p) => (
              <div
                className={`setup-row ${part?.id === p.id ? "active" : ""}`}
                key={p.id}
              >
                <button
                  className="part-name-button"
                  onClick={() => select(p.id)}
                >
                  {p.name}
                </button>
                <input
                  aria-label={`Quantity ${p.name}`}
                  type="number"
                  min="1"
                  max="2000"
                  value={p.quantity}
                  onFocus={() => select(p.id)}
                  onChange={(e) => {
                    const n = e.target.valueAsNumber;
                    if (Number.isInteger(n) && n > 0 && n <= 2000)
                      onChange(setPartQuantity(job, p.id, n));
                  }}
                />
                <select
                  aria-label={`Material ${p.name}`}
                  value={p.materialId}
                  onFocus={() => select(p.id)}
                  onChange={(e) => {
                    const record = materials.find(
                      (m) => m.id === e.target.value,
                    )!;
                    const next = job.materials.some((m) => m.id === record.id)
                      ? job
                      : {
                          ...job,
                          materials: [
                            ...job.materials,
                            structuredClone(record),
                          ],
                        };
                    onChange(setPartMaterial(next, p.id, record.id));
                  }}
                >
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.thickness} mm
                    </option>
                  ))}
                </select>
                <span>
                  {placedCount(job, p.id)} / {p.quantity}
                </span>
              </div>
            ))}
          </div>
          {!job.parts.length && (
            <div className="setup-empty">
              Add a part to begin setting up this job.
            </div>
          )}
        </section>
        <section className="setup-process" aria-label="Part cutting settings">
          {part && material ? (
            <>
              <span className="eyebrow">PART CUTTING SETTINGS</span>
              <h2>{part.name}</h2>
              <label className="field">
                <span>Part name</span>
                <input
                  value={part.name}
                  onChange={(e) =>
                    e.target.value && updatePart({ name: e.target.value })
                  }
                />
              </label>
              <div className="field-grid">
                {(
                  [
                    ["lead", "Lead-in length · mm", 30],
                    ["pierce", "Pierce time · s", undefined],
                    ["pierceDiameter", "Pierce diameter · mm", 100],
                    ["feed", "Cut speed · mm/min", undefined],
                    ["kerf", "Kerf width · mm", 10],
                  ] as const
                ).map(([key, label, max]) => (
                  <label className="field" key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={key === "feed" ? "0.001" : "0"}
                      max={max}
                      step="0.1"
                      value={material[key] ?? 0}
                      onChange={(e) => {
                        if (max === undefined || e.target.valueAsNumber <= max)
                          process(key, e.target.valueAsNumber);
                      }}
                    />
                  </label>
                ))}
                <label className="field">
                  <span>Default cut side</span>
                  <select
                    value={part.cut}
                    onChange={(e) =>
                      updatePart({ cut: e.target.value as typeof part.cut })
                    }
                  >
                    <option value="outside">Outside</option>
                    <option value="inside">Inside</option>
                    <option value="centerline">Centerline</option>
                  </select>
                </label>
              </div>
              <h3>Pierce entry points</h3>
              {part.contours.map((c, i) => (
                <label className="field" key={i}>
                  <span>
                    Contour {i + 1} ·{" "}
                    {c.hole ? "hole" : c.closed ? "outer profile" : "open path"}{" "}
                    · entry %
                  </span>
                  <input
                    aria-label={`Contour ${i + 1} entry percent`}
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    disabled={!c.closed}
                    value={(c.startPosition ?? 0) * 100}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber;
                      if (Number.isFinite(n) && n >= 0 && n <= 100)
                        updatePart({
                          contours: part.contours.map((a, j) =>
                            j === i ? { ...a, startPosition: n / 100 } : a,
                          ),
                        });
                    }}
                  />
                </label>
              ))}
              <p className="micro">
                Entry is measured around each contour. Use the part editor to
                pick a position on the profile and place tabs. The pierce point
                is offset by the lead-in.
              </p>
              <button
                className="wide"
                onClick={() => onOpen({ kind: "part", id: part.id })}
              >
                Edit geometry, tabs & entry points
              </button>
              <button
                className="text-button"
                onClick={() =>
                  onChange({
                    ...job,
                    parts: job.parts.filter((p) => p.id !== part.id),
                    sheets: job.sheets.map((s) => ({
                      ...s,
                      placements: s.placements.filter(
                        (p) => p.partId !== part.id,
                      ),
                    })),
                  })
                }
              >
                Remove part
              </button>
            </>
          ) : (
            <p className="muted">
              Select a part to configure its cutting settings.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

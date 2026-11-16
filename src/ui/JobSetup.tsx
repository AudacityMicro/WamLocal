import { PresetSelector } from "./PresetSelector";
import { id } from "../core/model";
import { Pencil, Trash2 } from "lucide-react";
import { materialLabel, materialForMachine } from "../core/material-gauges";
import { JobPanel } from "./JobPanel";
import { useState, type ReactNode } from "react";
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
  activeSheetId,
  renderSheetPreview,
  onClearSelection,
  onSelectSheet,
  nestingPanel,
  nestingBusy = false,
}: {
  activeSheetId?: string;
  renderSheetPreview?: (sheet: Job["sheets"][number]) => ReactNode;
  onClearSelection?: () => void;
  onSelectSheet?: (id: string) => void;
  nestingPanel?: ReactNode;
  nestingBusy?: boolean;
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
      (m) => !job.materials.some((a) => a.id === m.id),
    ),
  ];
  const removePart = (id: string) =>
    onChange({
      ...job,
      parts: job.parts.filter((p) => p.id !== id),
      sheets: job.sheets.map((s) => ({
        ...s,
        placements: s.placements.filter((p) => p.partId !== id),
      })),
    });
  return (
    <main
      className="job-setup"
      onPointerDown={(e) => {
        if (!(e.target as Element).closest(".sheet-preview"))
          onClearSelection?.();
      }}
    >
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
            disabled={nestingBusy || !job.parts.length}
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
              <span>Thickness</span>
              <span>Quality</span>
              <span>Actions</span>
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
                <PresetSelector
                  row
                  labelSuffix={p.name}
                  records={materials}
                  current={job.materials.find((m) => m.id === p.materialId)!}
                  machine={job.machine}
                  onChange={(selectedRecord) => {
                    const record = materialForMachine(
                      selectedRecord,
                      job.machine,
                    );
                    const next = job.materials.some((m) => m.id === record.id)
                      ? job
                      : { ...job, materials: [...job.materials, record] };
                    onChange(setPartMaterial(next, p.id, record.id));
                  }}
                />
                <div className="row-part-actions">
                  <button
                    title="Edit part"
                    aria-label={`Edit part ${p.name}`}
                    onClick={() => onOpen({ kind: "part", id: p.id })}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    title="Delete part"
                    aria-label={`Delete part ${p.name}`}
                    onClick={() => removePart(p.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
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
      </div>
      {nestingPanel && (
        <details className="job-nesting-options" open>
          <summary>Nesting options</summary>
          {nestingPanel}
        </details>
      )}
      <div className="job-sheets">
        <JobPanel
          sheetsOnly
          renderPreview={renderSheetPreview}
          onSelectSheet={onSelectSheet}
          job={job}
          view={{ kind: "sheet", id: activeSheetId ?? job.sheets[0].id }}
          onChange={onChange}
          presets={materials}
          onOpen={onOpen}
          onNewPart={onNewPart}
          onUpload={onUpload}
          onNest={onNest}
          onError={(message) => window.alert(message)}
        />
      </div>
    </main>
  );
}

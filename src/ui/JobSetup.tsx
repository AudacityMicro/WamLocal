import { NumericInput } from "./NumericInput";
import { PartThumbnail } from "./PartThumbnail";
import { JobSettings } from "./JobSettings";
import { Pencil, Trash2, Upload } from "lucide-react";
import { JobPanel } from "./JobPanel";
import { useState, type ReactNode } from "react";
import {
  placedCount,
  type Job,
  type JobView,
  type JobMaterial,
  type MaterialLibrary,
} from "../core/job";
import { setPartQuantity } from "../core/job-ops";

export function JobSetup({
  job,
  library,
  onChange,
  onOpen,
  onUpload,
  onNewPart,
  onNest,
  onPost,
  activeSheetId,
  renderSheetPreview,
  onClearSelection,
  onSelectSheet,
  nestingPanel,
  nestingBusy = false,
  onMaterialEdit,
}: {
  onMaterialEdit?: (mode: "new" | "edit", material: JobMaterial) => void;
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
  onPost: () => void;
}) {
  const [selected, select] = useState<string>();
  const part = job.parts.find((p) => p.id === selected) ?? job.parts[0];
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
      </header>
      <p className="job-machine-summary">
        WAZER {job.machine === "pro" ? "Pro" : "Desktop"}
      </p>
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
                  <PartThumbnail contours={p.contours} />
                  <span>{p.name}</span>
                </button>
                <NumericInput
                  aria-label={`Quantity ${p.name}`}
                  integer

                  min="0"
                  max="2000"
                  value={p.quantity}
                  onFocus={() => select(p.id)}
                  onChange={(e) => {
                    const n = e;
                    if (Number.isInteger(n) && n >= 0 && n <= 2000)
                      onChange(setPartQuantity(job, p.id, n));
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
              <p>Add a part to begin setting up this job.</p>
              <button onClick={onUpload}>
                <Upload size={16} /> Upload parts
              </button>
            </div>
          )}
        </section>
      </div>
      <JobSettings
        onMaterialEdit={onMaterialEdit}
        job={job}
        materials={materials}
        library={library}
        onChange={onChange}
      />
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

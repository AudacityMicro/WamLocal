import { useEffect, useRef, useState } from "react";
import { RotateCcw, Upload, Plus, Play, Download } from "lucide-react";
import { jobSchema, type Job } from "../core/job";
export function JobActions({
  job,
  onChange,
  onUpload,
  onNewPart,
  onPost,
  onNest,
  busy,
}: {
  job: Job;
  onChange: (job: Job) => void;
  onUpload: () => void;
  onNewPart: () => void;
  onPost: () => void;
  onNest: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(job.name),
    focused = useRef(false),
    cancelled = useRef(false);
  useEffect(() => {
    if (!focused.current) setName(job.name);
  }, [job.name]);
  return (
    <section className="job-actions">
      <label className="field">
        <span>Job name</span>
        <div className="job-name-control">
          <textarea
            rows={3}
            aria-label="Job name"
            value={focused.current ? name : job.name}
            onFocus={() => {
              focused.current = true;
              cancelled.current = false;
              setName(job.name);
            }}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              focused.current = false;
              if (!cancelled.current && name.trim() && name.trim() !== job.name)
                onChange(
                  jobSchema.parse({
                    ...job,
                    name: name.trim(),
                    nameMode: "manual",
                  }),
                );
              else setName(job.name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                cancelled.current = true;
                setName(job.name);
                e.currentTarget.blur();
              }
            }}
          />
          {job.nameMode !== "auto" && (
            <button
              aria-label="Use automatic job name"
              title="Use automatic job name"
              onClick={() =>
                onChange(jobSchema.parse({ ...job, nameMode: "auto" }))
              }
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </label>
      <div className="job-action-buttons">
        <button onClick={onUpload} disabled={busy}>
          <Upload size={15} />
          Upload parts
        </button>
        <button onClick={onNewPart} disabled={busy}>
          <Plus size={15} />
          New part
        </button>
        <button
          onClick={onPost}
          disabled={busy || !job.sheets.some((s) => s.placements.length)}
        >
          <Download size={15} />
          Post all
        </button>
        <button
          className="primary"
          onClick={onNest}
          disabled={busy || !job.parts.length}
        >
          <Play size={15} />
          Nest job
        </button>
      </div>
    </section>
  );
}

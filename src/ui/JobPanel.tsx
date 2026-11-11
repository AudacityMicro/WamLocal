import { id } from "../core/model";
import { placedCount, type Job, type JobView } from "../core/job";
import {
  placeDefinition,
  setPartMaterial,
  setPartQuantity,
} from "../core/job-ops";
export function JobPanel({
  sheetsOnly = false,
  job,
  view,
  onChange,
  onOpen,
  onNewPart,
  onUpload,
  onNest,
  onError,
}: {
  sheetsOnly?: boolean;
  job: Job;
  view: JobView;
  onChange: (job: Job) => void;
  onOpen: (view: JobView) => void;
  onNewPart: () => void;
  onUpload: () => void;
  onNest: () => void;
  onError: (message: string) => void;
}) {
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
            className={`job-card ${view.kind === "sheet" && view.id === s.id ? "active" : ""}`}
            key={s.id}
          >
            <button
              className="job-item"
              onClick={() => onOpen({ kind: "sheet", id: s.id })}
            >
              {s.name}
            </button>
            <p className="micro">
              {s.stock.width} × {s.stock.height} mm · {s.placements.length}{" "}
              parts · WCS {s.wcs.x}, {s.wcs.y}
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
            <label className="field">
              <span>Sheet material</span>
              <select
                value={s.materialId}
                onChange={(e) =>
                  onChange({
                    ...job,
                    sheets: job.sheets.map((a) =>
                      a.id === s.id
                        ? { ...a, materialId: e.target.value, placements: [] }
                        : a,
                    ),
                  })
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
              <button onClick={() => onOpen({ kind: "sheet", id: s.id })}>
                Open sheet
              </button>
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
        <p className="micro">
          Removing a sheet or changing its material returns affected copies to
          the unplaced quantity.
        </p>
      </section>
    </>
  );
}

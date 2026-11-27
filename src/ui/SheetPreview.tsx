import {NumericInput} from "./NumericInput";
import { boxSelectParts } from "../core/box-selection";
import { GcodeSimulator } from "./GcodeSimulator";
import {
  useMemo,
  useState,
  useRef,
  useEffect,
  useId,
  type PointerEvent,
} from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  ScanLine,
  Copy,
  Trash2,
  Pencil,
  Magnet,
} from "lucide-react";
import { sheetProject, BED, type Job, type Sheet } from "../core/job";
import { transformed, partBounds } from "../core/geometry";
import { planForPosting as plan } from "../core/postprocessor";
import type { Part, Point } from "../core/model";
import type { PlacementChange } from "../core/sheet-placement";
import { partCenter, rotatePartFromPointer } from "../core/part-transform";
import { workOriginPoint } from "../core/work-origin";
import { LengthInput, useDisplayUnits } from "./display-units";
import { PartControls } from "./PartControls";
export function SheetPreview({
  job,
  sheet,
  selectedId,
  selectedIds,
  onSelectMany,
  onTransformMany,
  controlsId,
  showLabels,
  onSelect,
  onControls,
  onTransform,
  onDuplicate,
  onDelete,
  onEdit,
  onNest,
  onPost,
  showPaths,
  onShowPaths,
  disabled = false,
}: {
  showPaths: boolean;
  onShowPaths: (value: boolean) => void;
  job: Job;
  sheet: Sheet;
  selectedId: string | null;
  selectedIds: string[];
  onSelectMany: (sheetId: string, ids: string[]) => void;
  onTransformMany: (
    sheetId: string,
    changes: { id: string; change: PlacementChange }[],
  ) => void;
  controlsId: string | null;
  showLabels: boolean;
  onSelect: (sheetId: string, partId: string | null) => void;
  onControls: (id: string | null) => void;
  onTransform: (sheetId: string, id: string, change: PlacementChange) => void;
  onDuplicate: (sheetId: string, id: string) => void;
  onDelete: (sheetId: string, id: string) => void;
  onEdit: (id: string) => void;
  onNest: (id: string) => void;
  onPost: (id?: string) => void;
  disabled?: boolean;
}) {
  const u = useDisplayUnits(),
    svg = useRef<SVGSVGElement>(null),
    patternId = useId().replace(/:/g, "");
  const [simulating, setSimulating] = useState(false);
  const [snap, setSnap] = useState(true),
    [zoom, setZoom] = useState(1),
    [fit, setFit] = useState<"stock" | "bed">("stock"),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [size, setSize] = useState({ width: 600, height: 400 });
  const [draft, setDraft] = useState<{
      id: string;
      change: PlacementChange;
    } | null>(null),
    draftRef = useRef<typeof draft>(null);
  const drag = useRef<{
    kind: "move" | "rotate" | "pan" | "box";
    members?: Part[];
    initialSelection?: string[];
    part?: Part;
    start: Point;
    client: Point;
    pan: Point;
  } | null>(null);
  const [box, setBox] = useState<{ start: Point; end: Point } | null>(null);
  const boxRef = useRef<typeof box>(null);
  const selectedSet = new Set(selectedIds);
  const project = useMemo(() => sheetProject(job, sheet.id), [job, sheet.id]);
  const paths = useMemo(
    () => (showPaths ? plan(project) : null),
    [project, showPaths],
  );
  const parts = useMemo(
    () =>
      project.parts.map((p) =>
        draft?.id === p.id
          ? { ...p, ...draft.change }
          : draft &&
              drag.current?.kind === "move" &&
              drag.current.members?.some((m) => m.id === p.id)
            ? {
                ...p,
                x:
                  p.x + (draft.change.x ?? p.x) - (drag.current.part?.x ?? p.x),
                y:
                  p.y + (draft.change.y ?? p.y) - (drag.current.part?.y ?? p.y),
              }
            : p,
      ),
    [project, draft],
  );
  const selected = parts.find((p) => p.id === selectedId),
    origin = sheet.wcs,
    workOrigin = workOriginPoint(sheet,project.parts),
    machine = job.machineSettings ?? BED;
  const base =
    fit === "bed"
      ? { x: -12, y: -12, width: BED.width + 24, height: BED.height + 24 }
      : {
          x: origin.x - 12,
          y: origin.y - 12,
          width: sheet.stock.width + 24,
          height: sheet.stock.height + 24,
        };
  const view = {
      x: base.x + pan.x,
      y: base.y + pan.y,
      width: base.width / zoom,
      height: base.height / zoom,
    },
    pixelsPerMm = Math.min(size.width / view.width, size.height / view.height);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom((z) =>
          Math.max(0.25, Math.min(10, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))),
        );
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const point = (e: { clientX: number; clientY: number }) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x - origin.x, y: p.y - origin.y };
  };
  const begin = (
    e: PointerEvent,
    kind: "move" | "rotate" | "pan" | "box",
    part?: Part,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = {
      kind,
      part,
      members:
        kind === "move"
          ? project.parts.filter(
              (p) =>
                p.id === part?.id ||
                (selectedSet.has(part?.id ?? "") && selectedSet.has(p.id)),
            )
          : undefined,
      initialSelection: e.ctrlKey || e.metaKey ? selectedIds : [],
      start: point(e),
      client: { x: e.clientX, y: e.clientY },
      pan,
    };
    // Keep the original hit target so double-clicks still reach the part.
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const end = (e: PointerEvent) => {
    const change = draftRef.current;
    const d = drag.current;
    if (d?.kind === "box") {
      const end = point(e);
      const hits =
        Math.hypot(e.clientX - d.client.x, e.clientY - d.client.y) > 3
          ? boxSelectParts(project.parts, d.start, end)
          : [];
      onSelectMany(sheet.id, [
        ...new Set([...(d.initialSelection ?? []), ...hits]),
      ]);
    } else if (change && d?.kind === "move" && d.members?.length) {
      const dx = (change.change.x ?? d.part!.x) - d.part!.x,
        dy = (change.change.y ?? d.part!.y) - d.part!.y;
      onTransformMany(
        sheet.id,
        d.members.map((p) => ({
          id: p.id,
          change: { x: p.x + dx, y: p.y + dy },
        })),
      );
    } else if (change) onTransform(sheet.id, change.id, change.change);
    setBox(null);
    boxRef.current = null;
    drag.current = null;
    draftRef.current = null;
    setDraft(null);
    const target = e.target as Element;
    if (target.hasPointerCapture?.(e.pointerId))
      target.releasePointerCapture(e.pointerId);
  };
  const fitView = (mode: "stock" | "bed") => {
    setFit(mode);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  return (
    <div className="sheet-preview" data-sheet-preview={sheet.id}>
      {simulating && (
        <GcodeSimulator
          job={job}
          sheet={sheet}
          onClose={() => setSimulating(false)}
        />
      )}
      <div className="sheet-preview-toolbar">
        <button
          onClick={() => onPost(sheet.id)}
          disabled={disabled || !project.parts.length}
          aria-label={`Post sheet ${sheet.name}`}
        >
          Post sheet
        </button>
        <button
          onClick={() => onPost()}
          disabled={disabled || !job.sheets.some((s) => s.placements.length)}
          aria-label={`Post all sheets from ${sheet.name}`}
        >
          Post all
        </button>
        <button
          aria-label={`Simulate ${sheet.name}`}
          disabled={disabled || !project.parts.length}
          onClick={() => setSimulating(true)}
        >
          Simulate
        </button>
        <label className="check">
          <input
            type="checkbox"
            aria-label={`Show toolpaths ${sheet.name}`}
            checked={showPaths}
            onChange={(e) => onShowPaths(e.target.checked)}
          />
          Show toolpaths
        </label>
        <button
          onClick={() => onNest(sheet.id)}
          disabled={disabled || !project.parts.length}
        >
          Nest sheet
        </button>
        <span />
        <button
          aria-label={`Zoom out ${sheet.name}`}
          title="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}
        >
          <ZoomOut size={15} />
        </button>
        <button
          aria-label={`Zoom in ${sheet.name}`}
          title="Zoom in"
          onClick={() => setZoom((z) => Math.min(10, z * 1.25))}
        >
          <ZoomIn size={15} />
        </button>
        <button
          aria-label={`Fit sheet ${sheet.name}`}
          title="Fit sheet"
          onClick={() => fitView("stock")}
        >
          <ScanLine size={15} />
        </button>
        <button
          aria-label={`Fit bed ${sheet.name}`}
          title="Fit bed"
          onClick={() => fitView("bed")}
        >
          <Maximize size={15} />
        </button>
        <button
          aria-label={`Snap placement ${sheet.name}`}
          title={`Snap to ${u.length(1)} grid`}
          aria-pressed={snap}
          onClick={() => setSnap((v) => !v)}
        >
          <Magnet size={15} />
        </button>
      </div>
      <div className="sheet-preview-canvas">
        <svg
          ref={svg}
          className="sheet-preview-svg"
          aria-label={`${sheet.name} layout preview`}
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
              e.preventDefault();
              e.stopPropagation();
              onSelectMany(
                sheet.id,
                project.parts.map((p) => p.id),
              );
              onControls(null);
            } else if (e.key === "Escape") {
              onSelectMany(sheet.id, []);
              onControls(null);
            }
          }}
          viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
          onPointerDown={(e) => {
            if (e.altKey || e.button === 1) begin(e, "pan");
            else if (e.button === 0) {
              svg.current?.focus();
              onControls(null);
              begin(e, "box");
              boxRef.current = { start: point(e), end: point(e) };
              setBox(boxRef.current);
            }
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            if (d.kind === "pan") {
              setPan({
                x: d.pan.x - (e.clientX - d.client.x) / pixelsPerMm,
                y: d.pan.y - (e.clientY - d.client.y) / pixelsPerMm,
              });
              return;
            }
            if (d.kind === "box") {
              boxRef.current = { start: d.start, end: point(e) };
              setBox(boxRef.current);
              return;
            }
            if (!d.part) return;
            const at = point(e);
            let change: PlacementChange;
            if (d.kind === "rotate") {
              const p = rotatePartFromPointer(
                d.part,
                partCenter(d.part),
                d.start,
                at,
                e.shiftKey,
              );
              change = { x: p.x, y: p.y, rotation: p.rotation };
            } else {
              const round = (n: number) =>
                snap && !e.shiftKey ? Math.round(n) : n;
              change = {
                x: round(d.part.x + at.x - d.start.x),
                y: round(d.part.y + at.y - d.start.y),
              };
            }
            draftRef.current = { id: d.part.id, change };
            setDraft(draftRef.current);
          }}
          onPointerUp={end}
          onPointerCancel={() => {
            setBox(null);
            boxRef.current = null;
            drag.current = null;
            draftRef.current = null;
            setDraft(null);
          }}
        >
          <defs>
            <pattern
              id={patternId}
              width="10"
              height="10"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M10 0H0V10"
                fill="none"
                stroke="#90acb0"
                strokeOpacity=".12"
                strokeWidth=".2"
              />
            </pattern>
          </defs>
          <rect
            data-layer="machine-bed"
            x={0}
            y={0}
            width={BED.width}
            height={BED.height}
            fill="#172328"
            stroke="#53656b"
            strokeWidth=".6"
          />
          <rect
            data-layer="cutting-area"
            x={0}
            y={0}
            width={machine.width}
            height={machine.height}
            fill="none"
            stroke="#e9a66d"
            strokeDasharray="3 2"
            strokeWidth=".5"
          />
          {sheet.stock.outline ? (
            <polygon
              data-layer="stock"
              points={sheet.stock.outline
                .map((p) => `${p.x + origin.x},${p.y + origin.y}`)
                .join(" ")}
              fill="#384b43"
              stroke="#a9b6ae"
              strokeWidth=".5"
            />
          ) : (
            <rect
              data-layer="stock"
              x={origin.x}
              y={origin.y}
              width={sheet.stock.width}
              height={sheet.stock.height}
              fill="#384b43"
              stroke="#a9b6ae"
              strokeWidth=".5"
            />
          )}
          <rect
            x={0}
            y={0}
            width={BED.width}
            height={BED.height}
            fill={`url(#${patternId})`}
            pointerEvents="none"
          />
          <rect
            data-layer="sheet-layout"
            x={origin.x + sheet.stock.margin}
            y={origin.y + sheet.stock.margin}
            width={Math.max(0, sheet.stock.width - 2 * sheet.stock.margin)}
            height={Math.max(0, sheet.stock.height - 2 * sheet.stock.margin)}
            fill="#1a485025"
            stroke="#b5bd8b"
            strokeWidth=".4"
            strokeDasharray="2 2"
            pointerEvents="none"
          />
          <g transform={`translate(${origin.x} ${origin.y})`}>
            {(sheet.stock.exclusions ?? []).map((p, i) => (
              <polygon
                key={i}
                points={p.map((v) => `${v.x},${v.y}`).join(" ")}
                fill="#172328"
                stroke="#c67e66"
                strokeDasharray="2 1"
                strokeWidth=".5"
              />
            ))}
            {parts.map((p) => (
              <g
                key={p.id}
                data-placement-id={p.id}
                onPointerDown={(e) => {
                  if (e.altKey || e.button === 1) {
                    begin(e, "pan");
                    return;
                  }
                  if (e.button !== 0) return;
                  svg.current?.focus();
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectMany(
                      sheet.id,
                      selectedSet.has(p.id)
                        ? selectedIds.filter((id) => id !== p.id)
                        : [...selectedIds, p.id],
                    );
                    onControls(null);
                    return;
                  }
                  if (!selectedSet.has(p.id)) onSelectMany(sheet.id, [p.id]);
                  if (controlsId !== p.id) onControls(null);
                  begin(e, "move", p);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onSelect(sheet.id, p.id);
                  onControls(p.id);
                }}
              >
                <path
                  d={transformed(p)
                    .map(
                      (c) =>
                        `M${c.points.map((v) => `${v.x},${v.y}`).join(" L")}${c.closed ? " Z" : ""}`,
                    )
                    .join(" ")}
                  fill={selectedSet.has(p.id) ? "#e7a66c25" : "#a0bfba14"}
                  fillRule="evenodd"
                  stroke={selectedSet.has(p.id) ? "#f5b174" : "#aec7c8"}
                  strokeWidth={selectedSet.has(p.id) ? 1.5 : 1}
                  vectorEffect="non-scaling-stroke"
                />
                {showLabels && (
                  <text
                    className="part-label"
                    x={partBounds(p).x}
                    y={partBounds(p).y - 2}
                    pointerEvents="none"
                  >
                    {p.name}
                  </text>
                )}
              </g>
            ))}
            {showPaths && !draft && paths && (
              <g data-layer="toolpaths" pointerEvents="none">
                {paths.moves.map((m, i) => (
                  <line
                    key={i}
                    x1={m.from.x}
                    y1={m.from.y}
                    x2={m.to.x}
                    y2={m.to.y}
                    stroke={
                      m.kind === "rapid"
                        ? "#83a7b1"
                        : m.kind === "tab"
                          ? "#eac76e"
                          : "#89d6ac"
                    }
                    strokeWidth={m.kind === "rapid" ? 0.5 : 1.5}
                    strokeDasharray={m.kind === "rapid" ? "3 2" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {paths.pierces.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.point.x}
                    cy={p.point.y}
                    r={Math.max(0.25, p.radius)}
                    fill={p.warning ? "#e58d6b66" : "#85d5ab44"}
                    stroke={p.warning ? "#ec996d" : "#a1dfc1"}
                    strokeWidth=".4"
                  />
                ))}
              </g>
            )}
            <path
              data-layer="work-origin"
              transform={`translate(${workOrigin.x} ${workOrigin.y})`}
              d="M-3 0H3M0-3V3"
              stroke="#efad76"
              strokeWidth=".6"
              pointerEvents="none"
            />
            {box && (
              <rect
                data-layer="selection-box"
                data-selection-mode={
                  box.end.x >= box.start.x ? "window" : "crossing"
                }
                x={Math.min(box.start.x, box.end.x)}
                y={Math.min(box.start.y, box.end.y)}
                width={Math.abs(box.end.x - box.start.x)}
                height={Math.abs(box.end.y - box.start.y)}
                fill={box.end.x >= box.start.x ? "#f39a382e" : "#52c4872e"}
                stroke={box.end.x >= box.start.x ? "#f5a34c" : "#64d69b"}
                strokeDasharray={box.end.x >= box.start.x ? undefined : "5 3"}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {selectedIds.length === 1 &&
              selected &&
              controlsId === selected.id && (
                <PartControls
                  part={selected}
                  pixelsPerMm={pixelsPerMm}
                  view={{ ...view, x: view.x - origin.x, y: view.y - origin.y }}
                  onRotate={(e) => begin(e, "rotate", selected)}
                  onDuplicate={() => onDuplicate(sheet.id, selected.id)}
                  onDelete={() => onDelete(sheet.id, selected.id)}
                />
              )}
          </g>
        </svg>
      </div>
      <div className="sheet-preview-help">
        Ctrl+click to select parts / Ctrl+A selects all / Box right: enclosed ·
        left: touching / Alt + drag to pan
      </div>
      {selectedIds.length > 1 && (
        <div className="sheet-placement-controls">
          <b>{selectedIds.length} parts selected</b>
          <span>Drag to move together · Ctrl+C to copy · Delete to remove</span>
        </div>
      )}
      {selectedIds.length === 1 && selected && (
        <div className="sheet-placement-controls">
          <b>{selected.name}</b>
          <label>
            X ({u.unit})
            <LengthInput
              aria-label={`${sheet.name} selected part X`}
              value={selected.x - workOrigin.x}
              min={-10000}
              max={10000}
              onChange={(x) =>
                onTransform(sheet.id, selected.id, { x: x + workOrigin.x })
              }
            />
          </label>
          <label>
            Y ({u.unit})
            <LengthInput
              aria-label={`${sheet.name} selected part Y`}
              value={selected.y - workOrigin.y}
              min={-10000}
              max={10000}
              onChange={(y) =>
                onTransform(sheet.id, selected.id, { y: y + workOrigin.y })
              }
            />
          </label>
          <label>
            Rotation
            <NumericInput
              aria-label={`${sheet.name} selected part rotation`} unit="deg"

              value={Number(selected.rotation.toFixed(3))}
              onChange={(e) => {
                const rotation = e;
                if (Number.isFinite(rotation))
                  onTransform(sheet.id, selected.id, { rotation });
              }}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={selected.locked ?? false}
              onChange={(e) =>
                onTransform(sheet.id, selected.id, { locked: e.target.checked })
              }
            />
            Lock for nesting
          </label>
          <div className="button-row">
            <button
              title="Edit source part"
              aria-label={`Edit source part ${sheet.name}`}
              onClick={() =>
                selected.definitionId && onEdit(selected.definitionId)
              }
            >
              <Pencil size={15} />
            </button>
            <button
              title="Duplicate placement"
              aria-label={`Duplicate placement ${sheet.name}`}
              onClick={() => onDuplicate(sheet.id, selected.id)}
            >
              <Copy size={15} />
            </button>
            <button
              title="Remove placement"
              aria-label={`Remove placement ${sheet.name}`}
              onClick={() => onDelete(sheet.id, selected.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      )}
      {paths && (
        <details className="sheet-preview-checks">
          <summary>
            Cut checks ({paths.issues.length}) / {u.number(paths.cutLength)}{" "}
            {u.unit} / {paths.minutes.toFixed(1)} min
          </summary>
          {paths.issues.length ? (
            paths.issues.map((s, i) => <p key={i}>{s}</p>)
          ) : (
            <p>No basic geometry warnings.</p>
          )}
        </details>
      )}
    </div>
  );
}

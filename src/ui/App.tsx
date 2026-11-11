import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  MousePointer2,
  PenTool,
  Square,
  Circle,
  Copy,
  Trash2,
  Undo2,
  Redo2,
  Upload,
  Download,
  FolderOpen,
  Plus,
  Play,
  Pause,
  Layers,
  Settings2,
  Workflow,
  BoxSelect,
  ScanLine,
  Terminal,
  Check,
  ChevronRight,
  Magnet,
  Maximize,
  ZoomIn,
  ZoomOut,
  Command,
  X,
  AlertTriangle,
  Save,
  ClipboardCopy,
  ClipboardPaste,
  Briefcase,
  Database,
} from "lucide-react";
import {
  newProject,
  makePart,
  rectangle,
  circle,
  id,
  projectSchema,
  type Project,
  type Part,
  type Point,
} from "../core/model";
import {
  transformed,
  partBounds,
  plan,
  nest,
  svgExport,
} from "../core/geometry";
type Mode =
  | "job"
  | "sheets"
  | "design"
  | "nest"
  | "paths"
  | "material"
  | "library"
  | "mcp";
import { JobSetup } from "./JobSetup";
import { JobPanel } from "./JobPanel";
import { MaterialsDatabase } from "./MaterialsDatabase";
import { PartProcessEditor } from "./PartProcessEditor";
import {
  BED,
  readJob,
  newJob,
  viewProject,
  jobSchema,
  materialLibrarySchema,
  placedCount,
  type Job,
  type JobView,
  type JobMaterial,
  type MaterialLibrary,
} from "../core/job";
import {
  editView,
  newDefinition,
  setPartMaterial,
  setPartQuantity,
} from "../core/job-ops";
import { initialMaterialLibrary } from "../core/material-library";
import { closestOnPath, pointOnPath } from "../core/path-math";
import { MaterialPresets } from "./MaterialPresets";
import { PartControls } from "./PartControls";
import {
  encodePartClipboard,
  pastePartClipboard,
  PART_CLIPBOARD_MIME,
  isTextEditingTarget,
} from "../core/part-clipboard";
import { partCenter, rotatePartFromPointer } from "../core/part-transform";
function demo(): Project {
  const p = newProject();
  p.name = "Mounting kit · sample";
  const flange = makePart(
    "Mounting plate",
    [
      {
        closed: true,
        hole: false,
        points: [
          { x: 8, y: 0 },
          { x: 82, y: 0 },
          { x: 90, y: 8 },
          { x: 90, y: 62 },
          { x: 82, y: 70 },
          { x: 8, y: 70 },
          { x: 0, y: 62 },
          { x: 0, y: 8 },
        ],
      },
      ...[
        [12, 12],
        [68, 12],
        [12, 48],
        [68, 48],
      ].map(([x, y]) => ({
        ...circle(5),
        hole: true,
        points: circle(5).points.map((p) => ({ x: p.x + x, y: p.y + y })),
      })),
      {
        ...circle(16),
        hole: true,
        points: circle(16).points.map((p) => ({ x: p.x + 29, y: p.y + 19 })),
      },
    ],
    30,
    32,
  );
  p.parts = [
    flange,
    {
      ...structuredClone(flange),
      id: id(),
      name: "Mounting plate · 02",
      x: 145,
      y: 32,
    },
    makePart(
      "Angle bracket",
      [
        {
          closed: true,
          hole: false,
          points: [
            { x: 0, y: 0 },
            { x: 85, y: 0 },
            { x: 85, y: 22 },
            { x: 25, y: 22 },
            { x: 25, y: 60 },
            { x: 0, y: 60 },
          ],
        },
      ],
      265,
      32,
    ),
    makePart(
      "Spacer ring",
      [
        circle(28),
        {
          ...circle(15),
          hole: true,
          points: circle(15).points.map((p) => ({ x: p.x + 13, y: p.y + 13 })),
        },
      ],
      35,
      140,
    ),
  ];
  return p;
}
function loadDraft() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem("wam-local-draft");
    return readJob(raw ? JSON.parse(raw) : demo());
  } catch {
    if (raw)
      try {
        localStorage.setItem(`wam-local-recovery-${Date.now()}`, raw);
      } catch {}
    return readJob(demo());
  }
}
function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 10000,
  step = 1,
  suffix = "mm",
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="number"
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          value={Number(value.toFixed(3))}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
        />
        <small>{suffix}</small>
      </div>
    </label>
  );
}
function Tool({
  title,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export default function App() {
  const [job, setJob] = useState<Job>(loadDraft);
  const [view, setView] = useState<JobView>(() => ({
    kind: "sheet",
    id: job.sheets[0].id,
  }));
  const activeView: JobView = (view.kind === "sheet"
    ? job.sheets
    : job.parts
  ).some((p) => p.id === view.id)
    ? view
    : { kind: "sheet", id: job.sheets[0].id };
  const project = useMemo(
    () => viewProject(job, activeView),
    [job, activeView.kind, activeView.id],
  );
  const activeSheet =
    activeView.kind === "sheet"
      ? job.sheets.find((s) => s.id === activeView.id)
      : undefined;
  const definition =
    activeView.kind === "part"
      ? job.parts.find((p) => p.id === activeView.id)
      : undefined;
  const origin = activeSheet?.wcs ?? { x: 0, y: 0 };
  const [library, setLibrary] = useState<MaterialLibrary>(() => {
    try {
      return materialLibrarySchema.parse(
        JSON.parse(localStorage.getItem("wam-material-library") ?? "null"),
      );
    } catch {
      return initialMaterialLibrary();
    }
  });
  const [libraryReady, setLibraryReady] = useState(false);
  const [contourIndex, setContourIndex] = useState(0);
  const [nestingBusy, setNestingBusy] = useState(false);
  const nestingWorker = useRef<Worker | null>(null),
    jobRef = useRef(job);
  jobRef.current = job;
  const [selected, setSelected] = useState<string | null>(null),
    [mode, setMode] = useState<Mode>("job"),
    [detailsOpen, setDetailsOpen] = useState(false),
    [tool, setTool] = useState<"select" | "nodes" | "pen" | "tabs" | "entry">(
      "select",
    ),
    [snap, setSnap] = useState(true),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [tab, setTab] = useState<"parts" | "issues">("parts"),
    [toast, setToast] = useState(""),
    [palette, setPalette] = useState(false),
    [query, setQuery] = useState(""),
    [rotate, setRotate] = useState(true),
    [progress, setProgress] = useState(100),
    [playing, setPlaying] = useState(false),
    [draft, setDraft] = useState<Point[]>([]),
    [dxfUnits, setDxfUnits] = useState<"mm" | "in">("mm");
  const [history, setHistory] = useState<Job[]>([]),
    [future, setFuture] = useState<Job[]>([]);
  const [controlsId, setControlsId] = useState<string | null>(null);
  const [pixelsPerMm, setPixelsPerMm] = useState(1);
  const lastPaste = useRef({ text: "", sequence: 0 });
  const svg = useRef<SVGSVGElement>(null),
    importInput = useRef<HTMLInputElement>(null),
    openInput = useRef<HTMLInputElement>(null),
    libraryInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{
    id: string;
    point: Point;
    original: Project;
    originalJob?: Job;
    node?: [number, number];
    pan?: boolean;
    panOrigin?: Point;
    rotate?: { center: Point };
    changed?: boolean;
  } | null>(null);
  const current = project.parts.find((p) => p.id === selected);
  const preview = useMemo(() => {
    try {
      const result = plan(project);
      if (
        activeSheet &&
        (origin.x < 0 ||
          origin.y < 0 ||
          origin.x + project.stock.width > BED.width ||
          origin.y + project.stock.height > BED.height)
      )
        result.issues.push("Stock at this WCS extends outside the WAZER bed.");
      return result;
    } catch (e) {
      return {
        moves: [],
        cutLength: 0,
        minutes: 0,
        issues: [String(e)],
        pierces: [],
      };
    }
  }, [project, origin.x, origin.y]);
  const material = (key: keyof Project["material"], value: number | string) =>
    edit({
      ...project,
      material: {
        ...project.material,
        preset:
          key === "kerf" || key === "tabCount"
            ? project.material.preset
            : undefined,
        [key]: value,
      },
    });
  function notify(s: string) {
    setToast(s);
  }
  function setProject(next: Project) {
    setJob((previous) => editView(previous, activeView, next));
  }
  function editJob(next: Job) {
    try {
      const valid = jobSchema.parse(next);
      setHistory((h) => [...h.slice(-79), job]);
      setFuture([]);
      setJob(valid);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function openView(next: JobView) {
    setView(next);
    setSelected(next.kind === "part" ? next.id : null);
    setControlsId(null);
    setDraft([]);
    setTool("select");
    setContourIndex(0);
    setMode("design");
  }
  function createPart() {
    const result = newDefinition(
      job,
      activeSheet?.materialId ?? definition?.materialId ?? job.materials[0].id,
    );
    editJob(result.job);
    openView({ kind: "part", id: result.partId });
  }
  function useMaterial(record: JobMaterial) {
    if (record.machine !== job.machine)
      return notify(
        "Choose the matching machine profile before applying this material preset.",
      );
    const next = structuredClone(job);
    next.materials = next.materials.filter((m) => m.id !== record.id);
    next.materials.push(structuredClone(record));
    if (activeView.kind === "part") {
      editJob(setPartMaterial(next, activeView.id, record.id));
    } else {
      next.sheets = next.sheets.map((s) =>
        s.id === activeView.id
          ? {
              ...s,
              materialId: record.id,
              placements: s.placements.filter(
                (i) =>
                  next.parts.find((p) => p.id === i.partId)?.materialId ===
                  record.id,
              ),
            }
          : s,
      );
      editJob(next);
    }
    notify("Preset snapshot applied to job");
  }
  function updateLibrary(next: MaterialLibrary) {
    try {
      setLibrary(materialLibrarySchema.parse(next));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function edit(p: Project) {
    try {
      const valid = projectSchema.parse(p);
      editJob(editView(job, activeView, valid));
    } catch (e) {
      notify(`Invalid change: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  function updatePart(change: Partial<Part>) {
    if (current)
      edit({
        ...project,
        parts: project.parts.map((p) =>
          p.id === selected ? { ...p, ...change } : p,
        ),
      });
  }
  function activateNodes() {
    if (activeSheet && current?.definitionId) {
      openView({ kind: "part", id: current.definitionId });
    }
    setTool("nodes");
    setControlsId(null);
  }
  function undo() {
    if (history.length) {
      setFuture((f) => [job, ...f]);
      setJob(history[history.length - 1]);
      setHistory((h) => h.slice(0, -1));
    }
  }
  function redo() {
    if (future.length) {
      setHistory((h) => [...h, job]);
      setJob(future[0]);
      setFuture((f) => f.slice(1));
    }
  }
  function save() {
    download(
      project.name.replace(/[^a-z\d_-]/gi, "_") + ".wam.json",
      JSON.stringify(job, null, 2),
    );
    notify("Job saved to file");
  }
  function add(shape: "rect" | "circle") {
    const part = makePart(
      shape === "rect" ? "Rectangle" : "Circle",
      [shape === "rect" ? rectangle() : circle()],
      20 + project.parts.length * 3,
      20 + project.parts.length * 3,
    );
    edit({ ...project, parts: [...project.parts, part] });
    setSelected(activeView.kind === "part" ? activeView.id : part.id);
    setTool("select");
  }
  function duplicate() {
    if (!current) return;
    const p = {
      ...structuredClone(current),
      id: id(),
      name: current.name + " copy",
      x: current.x + 8,
      y: current.y + 8,
    };
    edit({ ...project, parts: [...project.parts, p] });
    setSelected(activeView.kind === "part" ? activeView.id : p.id);
    setControlsId(activeView.kind === "part" ? activeView.id : p.id);
  }
  function pasteText(text: string) {
    try {
      const sequence =
        lastPaste.current.text === text ? lastPaste.current.sequence + 1 : 1;
      const result = pastePartClipboard(project, text, sequence);
      edit(result.project);
      lastPaste.current = { text, sequence };
      setSelected(activeView.kind === "part" ? activeView.id : result.ids[0]);
      setControlsId(null);
      setDraft([]);
      setTool("select");
      notify(`${result.ids.length === 1 ? "Part" : "Parts"} pasted`);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function copyPart() {
    if (!current) return notify("Select a part to copy");
    try {
      const text = encodePartClipboard([current]);
      if (window.partClipboard) await window.partClipboard.copy(text);
      else {
        const write = (e: ClipboardEvent) => {
          e.clipboardData?.setData("text/plain", text);
          e.preventDefault();
        };
        document.addEventListener("copy", write, true);
        let copied = false;
        try {
          copied = document.execCommand("copy");
        } finally {
          document.removeEventListener("copy", write, true);
        }
        if (!copied) throw Error("Copy unavailable");
      }
      lastPaste.current = { text: "", sequence: 0 };
      notify("Part copied");
    } catch {
      notify(
        "Clipboard access is unavailable. Select the part and use Ctrl+C.",
      );
    }
  }
  function pasteParts() {
    if (window.partClipboard) window.partClipboard.paste();
    else if (!document.execCommand("paste"))
      notify("Press Ctrl+V over the canvas to paste parts.");
  }
  function remove() {
    if (current) {
      edit({
        ...project,
        parts: project.parts.filter((p) => p.id !== selected),
      });
      setSelected(null);
      setControlsId(null);
    }
  }
  function runNest(all = false) {
    if (nestingBusy) return;
    if (all ? !job.parts.length : !project.parts.length)
      return notify("Add parts first");
    if (!all && activeView.kind === "part")
      return notify("Open a sheet to nest placed copies");
    const snapshot = job;
    setNestingBusy(true);
    const worker = new Worker(new URL("./nesting.worker.ts", import.meta.url), {
      type: "module",
    });
    nestingWorker.current = worker;
    const finish = () => {
      worker.terminate();
      nestingWorker.current = null;
      setNestingBusy(false);
    };
    worker.onmessage = (e) => {
      finish();
      if (!e.data.ok) return notify(e.data.error);
      if (jobRef.current !== snapshot)
        return notify("Job changed during nesting; result was not applied");
      if (all) {
        editJob(e.data.value);
        setView({ kind: "sheet", id: e.data.value.sheets[0].id });
      } else edit(e.data.value);
      setMode("nest");
      setSelected(null);
      notify("SVGnest placement complete");
    };
    worker.onerror = () => {
      finish();
      notify("Nesting worker failed; job was preserved");
    };
    worker.postMessage({
      kind: all ? "job" : "sheet",
      value: all ? job : project,
      rotate,
    });
  }
  function finishPen(closed = true) {
    if (draft.length < 2) return;
    const p = makePart(
      "Drawn path",
      [{ points: draft, closed: closed && draft.length > 2, hole: false }],
      0,
      0,
    );
    if (!p.contours[0].closed) p.cut = "centerline";
    edit({ ...project, parts: [...project.parts, p] });
    setSelected(activeView.kind === "part" ? activeView.id : p.id);
    setDraft([]);
    setTool("select");
  }
  useEffect(() => {
    try {
      localStorage.setItem("wam-local-draft", JSON.stringify(job));
    } catch {
      notify("Local autosave is unavailable. Save a project file.");
    }
  }, [job]);
  useEffect(() => {
    let active = true;
    (async () => {
      let loaded = true;
      try {
        if (window.materialDatabase) {
          const db = await window.materialDatabase.load();
          if (active) setLibrary(materialLibrarySchema.parse(db));
        }
      } catch (e) {
        loaded = false;
        notify("Could not load material database: " + (e as Error).message);
      } finally {
        if (active) setLibraryReady(loaded);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!libraryReady) return;
    localStorage.setItem("wam-material-library", JSON.stringify(library));
    if (window.materialDatabase)
      void window.materialDatabase
        .save(library)
        .catch(() =>
          notify("Material database could not be saved; export a backup."),
        );
  }, [library, libraryReady]);
  useEffect(() => () => nestingWorker.current?.terminate(), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(
      () =>
        setProgress((p) => {
          if (p >= 100) {
            setPlaying(false);
            return 100;
          }
          return Math.min(100, p + 0.6);
        }),
      50,
    );
    return () => clearInterval(t);
  }, [playing]);
  useEffect(() => {
    const measure = () => {
      const m = svg.current?.getScreenCTM();
      if (m) setPixelsPerMm(Math.hypot(m.a, m.b) || 1);
    };
    const observer = new ResizeObserver(measure);
    if (svg.current) observer.observe(svg.current);
    measure();
    return () => observer.disconnect();
  }, [zoom, pan.x, pan.y, project.stock.width, project.stock.height]);
  useEffect(() => {
    const copy = (e: ClipboardEvent) => {
      if (
        isTextEditingTarget(e.target) ||
        window.getSelection()?.toString() ||
        !current ||
        !e.clipboardData
      )
        return;
      try {
        const text = encodePartClipboard([current]);
        e.clipboardData.setData("text/plain", text);
        e.clipboardData.setData(PART_CLIPBOARD_MIME, text);
        e.preventDefault();
        lastPaste.current = { text: "", sequence: 0 };
        notify("Part copied");
      } catch (error) {
        e.preventDefault();
        notify((error as Error).message);
      }
    };
    const paste = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target) || !e.clipboardData) return;
      const text =
        e.clipboardData.getData(PART_CLIPBOARD_MIME) ||
        e.clipboardData.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      pasteText(text);
    };
    window.addEventListener("copy", copy);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("copy", copy);
      window.removeEventListener("paste", paste);
    };
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (isTextEditingTarget(e.target)) return;
      const cmd = e.ctrlKey || e.metaKey;
      const pressed = e.key.toLowerCase();
      if (cmd && pressed === "s") {
        e.preventDefault();
        save();
      } else if (cmd && pressed === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (cmd && pressed === "d") {
        e.preventDefault();
        duplicate();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.key === "Escape") {
        setDraft([]);
        setTool("select");
        setPalette(false);
        setControlsId(null);
      } else if (e.key === "Enter" && tool === "pen") finishPen(!e.shiftKey);
      else if (!cmd && e.key === "v") setTool("select");
      else if (!cmd && e.key === "n") {
        activateNodes();
        setControlsId(null);
      } else if (!cmd && e.key === "p") {
        setTool("pen");
        setControlsId(null);
      } else if (current && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        updatePart({
          x:
            current.x +
            (e.key === "ArrowRight" ? n : e.key === "ArrowLeft" ? -n : 0),
          y:
            current.y +
            (e.key === "ArrowDown" ? n : e.key === "ArrowUp" ? -n : 0),
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function point(e: { clientX: number; clientY: number }, useSnap = true) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const world = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    const p = { x: world.x - origin.x, y: world.y - origin.y };
    return {
      x: snap && useSnap ? Math.round(p.x) : p.x,
      y: snap && useSnap ? Math.round(p.y) : p.y,
    };
  }
  function endDrag() {
    const completed = drag.current;
    if (completed && !completed.pan && completed.changed) {
      setHistory((h) => [...h.slice(-79), completed.originalJob ?? job]);
      setFuture([]);
    }
    drag.current = null;
  }
  async function onImport(file?: File) {
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw Error("File is larger than 10 MB.");
      const source = await file.text();
      const { importSvg, importDxf } = await import("../core/import");
      const part = file.name.toLowerCase().endsWith(".dxf")
        ? importDxf(source, file.name, dxfUnits)
        : importSvg(source, file.name);
      if (mode === "job") {
        const materialId = activeSheet?.materialId ?? job.materials[0].id;
        editJob({
          ...job,
          parts: [...job.parts, { ...part, materialId, quantity: 1 }],
        });
        setSelected(null);
      } else {
        edit({ ...project, parts: [...project.parts, part] });
        setSelected(activeView.kind === "part" ? activeView.id : part.id);
      }
      notify("Imported vectors · check dimensions before planning");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const visible = preview.moves.slice(
    0,
    Math.ceil((preview.moves.length * progress) / 100),
  );
  const commands = [
    { name: "Import SVG / DXF", action: () => importInput.current?.click() },
    { name: "Save project", action: save },
    { name: "Open project", action: () => openInput.current?.click() },
    { name: "Nest all parts", action: runNest },
    { name: "Add rectangle", action: () => add("rect") },
    { name: "Add circle", action: () => add("circle") },
    {
      name: "Export SVG layout",
      action: () => download("layout.svg", svgExport(project), "image/svg+xml"),
    },
    { name: "Undo", action: undo },
    { name: "Redo", action: redo },
    {
      name: "Copy selected part",
      action: () => {
        void copyPart();
      },
    },
    {
      name: "Paste parts",
      action: () => {
        void pasteParts();
      },
    },
  ];
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            w<span>↗</span>
          </span>
          <b>
            WAM<span>LOCAL</span>
          </b>
        </div>
        <div className="project-name">
          <span className="green-dot" />
          {project.name}
          <small>
            {mode === "job"
              ? "Job setup"
              : definition
                ? `Part editor · ${definition.name}`
                : `${activeSheet?.name} · WCS ${origin.x}, ${origin.y}`}{" "}
            · Autosaved
          </small>
        </div>
        <div className="top-actions">
          <button onClick={() => setPalette(true)}>
            <Command size={14} /> Commands <kbd>Ctrl K</kbd>
          </button>
          <button onClick={save}>
            <Save size={15} />
            Save
          </button>
          <button
            className="primary"
            onClick={() =>
              download("layout.svg", svgExport(project), "image/svg+xml")
            }
          >
            <Download size={15} />
            Export SVG
          </button>
        </div>
      </header>
      <div className="body">
        <nav className="rail">
          {(
            [
              { key: "job", icon: <Briefcase />, name: "Jobs" },
              { key: "nest", icon: <BoxSelect />, name: "Nesting" },
              { key: "sheets", icon: <Layers />, name: "Sheets" },
              { key: "design", icon: <MousePointer2 />, name: "Design" },
              { key: "paths", icon: <Workflow />, name: "Toolpaths" },
              { key: "material", icon: <Layers />, name: "Material" },
              { key: "library", icon: <Database />, name: "Presets" },
              { key: "mcp", icon: <Terminal />, name: "MCP" },
            ] as const
          ).map((item) => (
            <button
              title={item.name}
              key={item.key}
              onClick={() => {
                if (
                  (item.key === "nest" || item.key === "sheets") &&
                  activeView.kind === "part"
                )
                  openView({ kind: "sheet", id: job.sheets[0].id });
                setMode(item.key);
              }}
              className={mode === item.key ? "selected" : ""}
            >
              {item.icon}
              <span>{item.name}</span>
            </button>
          ))}
        </nav>
        <aside className={`inspector ${mode === "job" ? "job-sidebar" : ""}`}>
          <div className="panel-heading">
            <span>WORKSPACE</span>
            <Settings2 size={14} />
          </div>
          <h2>
            {
              {
                job: "Jobs",
                sheets: "Sheets",
                library: "Materials database",
                design: "Design & arrange",
                nest: "Sheet nesting",
                paths: "Cut strategy",
                material: "Material setup",
                mcp: "MCP connection",
              }[mode]
            }
          </h2>
          {mode !== "job" && (
            <label className="field workspace-switch">
              <span>Active workspace</span>
              <select
                value={`${activeView.kind}:${activeView.id}`}
                onChange={(e) => {
                  const [kind, ...key] = e.target.value.split(":");
                  openView({
                    kind: kind as JobView["kind"],
                    id: key.join(":"),
                  });
                }}
              >
                <optgroup label="Sheets">
                  {job.sheets.map((s) => (
                    <option key={s.id} value={`sheet:${s.id}`}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Part editors">
                  {job.parts.map((p) => (
                    <option key={p.id} value={`part:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          )}
          {nestingBusy ? (
            <div className="notice">
              <p>Nesting in background…</p>
              <button
                onClick={() => {
                  nestingWorker.current?.terminate();
                  nestingWorker.current = null;
                  setNestingBusy(false);
                  notify("Nesting cancelled; job preserved");
                }}
              >
                Cancel
              </button>
            </div>
          ) : null}
          {mode === "mcp" ? (
            <>
              <p className="muted">
                Use a local MCP client to create, edit, nest, and inspect saved
                project files.
              </p>
              <div className="notice">
                <Terminal size={18} />
                <div>
                  <b>Local stdio server</b>
                  <p>
                    Starts on demand through your MCP client. No network
                    listener.
                  </p>
                </div>
              </div>
              <label className="field">
                <span>Run from this repository</span>
                <code>npm run mcp</code>
              </label>
              <p className="muted">
                Set WAM_PROJECT_DIR to your project folder. Available tools:
              </p>
              <ul className="tool-list">
                {[
                  "create_project",
                  "read_project",
                  "write_project",
                  "add_shape",
                  "update_part",
                  "nest_project",
                  "inspect_toolpaths",
                  "export_svg",
                  "list_material_presets",
                  "apply_material_preset",
                  "create_job",
                  "read_job",
                  "write_job",
                  "add_job_part",
                  "update_job_part",
                  "add_sheet",
                  "update_sheet",
                  "nest_job",
                  "inspect_job",
                  "read_material_library",
                  "write_material_library",
                ].map((t) => (
                  <li key={t}>
                    <Check size={12} />
                    <code>{t}</code>
                  </li>
                ))}
              </ul>
              <p className="muted">
                Files are shared on disk. Reopen a project after MCP edits;
                unsaved editor changes are separate.
              </p>
            </>
          ) : mode === "job" ? (
            <p className="muted">
              Set up your parts, quantities and cutting settings, then arrange
              them on sheets.
            </p>
          ) : mode === "sheets" ? (
            <JobPanel
              sheetsOnly
              job={job}
              view={activeView}
              onChange={editJob}
              onOpen={(next) => {
                openView(next);
                setMode("nest");
              }}
              onNewPart={createPart}
              onUpload={() => importInput.current?.click()}
              onNest={() => runNest(true)}
              onError={notify}
            />
          ) : mode === "library" ? (
            <MaterialsDatabase
              machine={job.machine}
              library={library}
              onChange={updateLibrary}
              onUse={useMaterial}
              onExport={() =>
                download("materials.json", JSON.stringify(library, null, 2))
              }
              onImport={() => libraryInput.current?.click()}
              onError={notify}
            />
          ) : (
            <>
              <section>
                <h3>{activeSheet ? "MACHINE & STOCK" : "PART WORKSPACE"}</h3>
                <label className="field">
                  <span>Machine profile</span>
                  <select
                    value={project.machine}
                    onChange={(e) =>
                      edit({
                        ...project,
                        machine: e.target.value as Project["machine"],
                        material: { ...project.material, preset: undefined },
                      })
                    }
                  >
                    <option value="desktop">WAZER Desktop</option>
                    <option value="pro">WAZER Pro</option>
                  </select>
                </label>
                {definition ? (
                  <>
                    <h3>PART DEFINITION</h3>
                    <label className="field">
                      <span>Requested quantity</span>
                      <input
                        type="number"
                        min="1"
                        max="2000"
                        value={definition.quantity}
                        onChange={(e) => {
                          const n = e.target.valueAsNumber;
                          if (Number.isInteger(n) && n > 0 && n <= 2000)
                            editJob(setPartQuantity(job, definition.id, n));
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>Part material</span>
                      <select
                        value={definition.materialId}
                        onChange={(e) =>
                          editJob(
                            setPartMaterial(job, definition.id, e.target.value),
                          )
                        }
                      >
                        {job.materials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} · {m.thickness} mm
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                <div className="field-grid">
                  <NumberField
                    label="Stock width"
                    disabled={!activeSheet}
                    value={project.stock.width}
                    min={1}
                    max={460}
                    onChange={(width) =>
                      edit({ ...project, stock: { ...project.stock, width } })
                    }
                  />
                  <NumberField
                    label="Stock height"
                    disabled={!activeSheet}
                    value={project.stock.height}
                    min={1}
                    max={305}
                    onChange={(height) =>
                      edit({ ...project, stock: { ...project.stock, height } })
                    }
                  />
                </div>
                <p className="micro">460 × 305 mm maximum cutting envelope</p>
                {activeSheet ? (
                  <>
                    <h3>SHEET WCS · BED COORDINATES</h3>
                    <div className="field-grid">
                      <NumberField
                        label="WCS X"
                        value={origin.x}
                        min={-460}
                        max={460}
                        step={0.1}
                        onChange={(x) =>
                          editJob({
                            ...job,
                            sheets: job.sheets.map((s) =>
                              s.id === activeSheet.id
                                ? { ...s, wcs: { ...s.wcs, x } }
                                : s,
                            ),
                          })
                        }
                      />
                      <NumberField
                        label="WCS Y"
                        value={origin.y}
                        min={-305}
                        max={305}
                        step={0.1}
                        onChange={(y) =>
                          editJob({
                            ...job,
                            sheets: job.sheets.map((s) =>
                              s.id === activeSheet.id
                                ? { ...s, wcs: { ...s.wcs, y } }
                                : s,
                            ),
                          })
                        }
                      />
                    </div>
                  </>
                ) : (
                  <p className="micro">
                    Part editor geometry is independent of sheet placement.
                  </p>
                )}
              </section>
              {mode === "nest" ? (
                <section>
                  <h3>
                    NESTING SETTINGS <span className="pill">SVGNEST</span>
                  </h3>
                  <div className="field-grid">
                    <NumberField
                      label="Edge margin"
                      value={project.stock.margin}
                      max={100}
                      onChange={(margin) =>
                        edit({
                          ...project,
                          stock: { ...project.stock, margin },
                        })
                      }
                    />
                    <NumberField
                      label="Part spacing"
                      value={project.stock.spacing}
                      max={100}
                      onChange={(spacing) =>
                        edit({
                          ...project,
                          stock: { ...project.stock, spacing },
                        })
                      }
                    />
                  </div>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={rotate}
                      onChange={(e) => setRotate(e.target.checked)}
                    />
                    Allow 90° rotation
                  </label>
                  <p className="muted">
                    Actual-outline placement with process clearance. Parts stay
                    grouped; nesting inside holes is disabled.
                  </p>
                  <button
                    disabled={nestingBusy}
                    className="primary wide"
                    onClick={() => runNest()}
                  >
                    <BoxSelect size={16} /> Nest all {project.parts.length}{" "}
                    parts
                  </button>
                  <p className="micro">
                    Nest this sheet, or use Job to fill all requested quantities
                    across sheets.
                  </p>
                </section>
              ) : null}
              {mode === "material" ? (
                <section>
                  <button
                    className="wide"
                    onClick={() => {
                      const materialId =
                        activeSheet?.materialId ?? definition!.materialId;
                      const m = job.materials.find((m) => m.id === materialId)!;
                      updateLibrary({
                        ...library,
                        materials: [
                          ...library.materials.filter((r) => r.id !== m.id),
                          { ...m, source: "Saved job defaults" },
                        ],
                      });
                      notify("Material defaults saved to database");
                    }}
                  >
                    Save these defaults to database
                  </button>
                </section>
              ) : null}
              {mode === "material" ? (
                <MaterialPresets
                  project={project}
                  onApply={(p) => {
                    edit(p);
                    notify("Material preset applied");
                  }}
                />
              ) : null}
              {mode === "material" || mode === "paths" ? (
                <section>
                  <h3>
                    {mode === "material"
                      ? "MATERIAL PARAMETERS"
                      : "TOOLPATH PARAMETERS"}
                  </h3>
                  {mode === "material" ? (
                    <>
                      <label className="field">
                        <span>Material name</span>
                        <input
                          value={project.material.name}
                          onChange={(e) => material("name", e.target.value)}
                        />
                      </label>
                      <NumberField
                        label="Thickness"
                        value={project.material.thickness}
                        min={0.01}
                        step={0.1}
                        onChange={(v) => material("thickness", v)}
                      />
                      <NumberField
                        label="Cut feed"
                        value={project.material.feed}
                        suffix="mm/min"
                        min={0.01}
                        onChange={(v) => material("feed", v)}
                      />
                      <NumberField
                        label="Pierce time"
                        value={project.material.pierce}
                        suffix="sec"
                        step={0.1}
                        onChange={(v) => material("pierce", v)}
                      />
                      <NumberField
                        label="Pierce diameter"
                        value={project.material.pierceDiameter ?? 0}
                        max={100}
                        step={0.1}
                        onChange={(v) => material("pierceDiameter", v)}
                      />
                      <p className="micro">
                        Use measured process diameter. Zero means unknown;
                        profile clearance cannot be checked.
                      </p>
                      <NumberField
                        label="Abrasive rate"
                        value={project.material.abrasive ?? 0}
                        suffix="g/min"
                        onChange={(v) => material("abrasive", v)}
                      />
                      <p className="micro">
                        Abrasive rate is saved for reference; simulation
                        estimates cut and pierce time only.
                      </p>
                    </>
                  ) : null}
                  <div className="field-grid">
                    <NumberField
                      label="Kerf width"
                      value={project.material.kerf}
                      max={10}
                      step={0.05}
                      onChange={(v) => material("kerf", v)}
                    />
                    <NumberField
                      label="Lead length"
                      value={project.material.lead}
                      max={30}
                      step={0.5}
                      onChange={(v) => material("lead", v)}
                    />
                    <NumberField
                      label="Tab width"
                      value={project.material.tabWidth}
                      max={20}
                      step={0.5}
                      onChange={(v) => material("tabWidth", v)}
                    />
                    <NumberField
                      label="Tabs / contour"
                      value={project.material.tabCount}
                      max={20}
                      suffix=""
                      onChange={(v) => material("tabCount", Math.round(v))}
                    />
                  </div>
                  <p className="micro">
                    Tabs apply to closed outer contours. Holes cut first. Leads
                    are straight tangent previews.
                  </p>
                  <div className="notice">
                    <AlertTriangle size={17} />
                    <div>
                      <b>Preview parameters</b>
                      <p>
                        Custom and recorded reference settings are editable.
                        Machine-specific cut export is not yet enabled.
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}
              {mode === "design" ? (
                <section>
                  <h3>IMPORT & CREATE</h3>
                  <button className="wide" onClick={createPart}>
                    New part editor
                  </button>
                  <button
                    className="import-button"
                    onClick={() => importInput.current?.click()}
                  >
                    <Upload size={19} />
                    <b>Import vectors</b>
                    <small>SVG or DXF</small>
                  </button>
                  <label className="field">
                    <span>DXF units if unspecified</span>
                    <select
                      value={dxfUnits}
                      onChange={(e) =>
                        setDxfUnits(e.target.value as "mm" | "in")
                      }
                    >
                      <option value="mm">Millimetres</option>
                      <option value="in">Inches</option>
                    </select>
                  </label>
                  <div className="button-row">
                    <button onClick={() => add("rect")}>
                      <Square size={14} />
                      Rectangle
                    </button>
                    <button onClick={() => add("circle")}>
                      <Circle size={14} />
                      Circle
                    </button>
                  </div>
                </section>
              ) : null}
              {definition && project.parts[0] ? (
                <PartProcessEditor
                  part={project.parts[0]}
                  selected={Math.min(
                    contourIndex,
                    project.parts[0].contours.length - 1,
                  )}
                  onSelect={setContourIndex}
                  onChange={(p) => edit({ ...project, parts: [p] })}
                  onTabs={() => {
                    setTool("tabs");
                    setSelected(definition.id);
                  }}
                  onEntry={() => {
                    setTool("entry");
                    setSelected(definition.id);
                  }}
                />
              ) : null}
              <section>
                <h3>
                  SELECTION{" "}
                  {current ? <span className="pill">1 PART</span> : null}
                </h3>
                <div className="button-row clipboard-actions">
                  <button
                    disabled={!current}
                    title="Copy part (Ctrl+C)"
                    onClick={() => {
                      void copyPart();
                    }}
                  >
                    <ClipboardCopy size={14} />
                    Copy part
                  </button>
                  <button
                    title="Paste parts (Ctrl+V)"
                    onClick={() => {
                      void pasteParts();
                    }}
                  >
                    <ClipboardPaste size={14} />
                    Paste parts
                  </button>
                </div>
                {current ? (
                  <>
                    {activeSheet && current.definitionId ? (
                      <button
                        className="wide"
                        onClick={() =>
                          openView({ kind: "part", id: current.definitionId! })
                        }
                      >
                        Edit source part · tabs & kerf
                      </button>
                    ) : null}
                    <label className="field">
                      <span>Part name</span>
                      <input
                        value={current.name}
                        onChange={(e) =>
                          updatePart({ name: e.target.value || "Part" })
                        }
                      />
                    </label>
                    <div className="field-grid">
                      <NumberField
                        label="Position X"
                        value={current.x}
                        min={-10000}
                        onChange={(x) => updatePart({ x })}
                      />
                      <NumberField
                        label="Position Y"
                        value={current.y}
                        min={-10000}
                        onChange={(y) => updatePart({ y })}
                      />
                      <NumberField
                        label="Rotation"
                        value={current.rotation}
                        min={-36000}
                        max={36000}
                        suffix="deg"
                        onChange={(rotation) => updatePart({ rotation })}
                      />
                      <NumberField
                        label="Scale"
                        value={current.scale * 100}
                        min={0.1}
                        max={100000}
                        suffix="%"
                        onChange={(scale) => updatePart({ scale: scale / 100 })}
                      />
                    </div>
                    <p className="micro">
                      Bounds {partBounds(current).width.toFixed(2)} ×{" "}
                      {partBounds(current).height.toFixed(2)} mm
                    </p>
                    <label className="field">
                      <span>Cut compensation</span>
                      <select
                        value={current.cut}
                        onChange={(e) =>
                          updatePart({ cut: e.target.value as Part["cut"] })
                        }
                      >
                        <option value="outside">Outside · preserve part</option>
                        <option value="inside">
                          Inside · preserve opening
                        </option>
                        <option value="centerline">Centerline</option>
                      </select>
                    </label>
                    <div className="button-row">
                      <button onClick={duplicate}>
                        <Copy size={14} />
                        Duplicate
                      </button>
                      <button onClick={remove}>
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty-selection">
                    <MousePointer2 size={24} />
                    <p>
                      Select a part to edit its geometry
                      <br />
                      and cutting properties.
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
          <div className="inspector-footer">
            <button onClick={() => openInput.current?.click()}>
              <FolderOpen size={14} />
              Open job
            </button>
            <button
              onClick={() => {
                const next = newJob(job.machine);
                editJob(next);
                setView({ kind: "sheet", id: next.sheets[0].id });
                setMode("job");
                setSelected(null);
                setControlsId(null);
                lastPaste.current = { text: "", sequence: 0 };
              }}
            >
              New job <Plus size={14} />
            </button>
          </div>
        </aside>
        {mode === "job" ? (
          <JobSetup
            job={job}
            library={library}
            onChange={editJob}
            onOpen={openView}
            onUpload={() => importInput.current?.click()}
            onNewPart={createPart}
            onNest={() => runNest(true)}
          />
        ) : (
          <main className="workspace">
            <div className="canvas-heading">
              <div>
                <span className="eyebrow">CUTTING BED</span>
                <b>
                  {project.machine === "desktop"
                    ? "WAZER Desktop"
                    : "WAZER Pro"}
                  <ChevronRight size={14} />
                  <span>
                    Bed 460 × 305 mm ·{" "}
                    {definition
                      ? "Part editor"
                      : `${activeSheet?.name} · stock ${project.stock.width} × ${project.stock.height} mm · WCS ${origin.x}, ${origin.y}`}
                  </span>
                </b>
              </div>
              <div className="canvas-badges">
                <button
                  onClick={() => setDetailsOpen((v) => !v)}
                  aria-expanded={detailsOpen}
                >
                  Parts & checks
                </button>
                <span>UNITS: MM</span>
              </div>
            </div>
            <div className="canvas-wrap">
              <div className="floating-tools">
                <Tool
                  title="Select / move (V)"
                  active={tool === "select"}
                  onClick={() => setTool("select")}
                >
                  <MousePointer2 size={18} />
                </Tool>
                <Tool
                  title="Edit nodes (N)"
                  active={tool === "nodes"}
                  onClick={activateNodes}
                >
                  <ScanLine size={18} />
                </Tool>
                <Tool
                  title="Draw polygon (P); Enter closes; Shift Enter leaves open"
                  active={tool === "pen"}
                  onClick={() => {
                    setTool("pen");
                    setMode("design");
                  }}
                >
                  <PenTool size={18} />
                </Tool>
                <span />
                <Tool title="Add rectangle" onClick={() => add("rect")}>
                  <Square size={18} />
                </Tool>
                <Tool title="Add circle" onClick={() => add("circle")}>
                  <Circle size={18} />
                </Tool>
                <span />
                <Tool
                  title="Undo (Ctrl Z)"
                  disabled={!history.length}
                  onClick={undo}
                >
                  <Undo2 size={18} />
                </Tool>
                <Tool
                  title="Redo (Ctrl Shift Z)"
                  disabled={!future.length}
                  onClick={redo}
                >
                  <Redo2 size={18} />
                </Tool>
              </div>
              <svg
                ref={svg}
                className={`bed tool-${tool}`}
                viewBox={`${-24 + pan.x} ${-22 + pan.y} ${(BED.width + 48) / zoom} ${(BED.height + 44) / zoom}`}
                onWheel={(e) =>
                  setZoom((z) =>
                    Math.max(0.6, Math.min(5, z * (e.deltaY > 0 ? 0.9 : 1.1))),
                  )
                }
                onPointerDown={(e) => {
                  if (e.button === 1 || e.altKey) {
                    e.preventDefault();
                    drag.current = {
                      id: "",
                      point: point(e),
                      original: project,
                      originalJob: job,
                      pan: true,
                      panOrigin: pan,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                    return;
                  }
                  if (tool === "pen") {
                    setDraft((d) => [...d, point(e)]);
                    return;
                  }
                  if (tool === "tabs" || tool === "entry") return;
                  setSelected(null);
                  setControlsId(null);
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d) return;
                  const at = point(e, !d.rotate);
                  if (d.pan) {
                    setPan({
                      x: pan.x + d.point.x - at.x,
                      y: pan.y + d.point.y - at.y,
                    });
                    return;
                  }
                  const original = d.original.parts.find((p) => p.id === d.id)!;
                  if (
                    !d.changed &&
                    Math.hypot(at.x - d.point.x, at.y - d.point.y) < 1e-9
                  )
                    return;
                  d.changed = true;
                  if (d.rotate) {
                    const rotated = rotatePartFromPointer(
                      original,
                      d.rotate.center,
                      d.point,
                      at,
                      e.shiftKey,
                    );
                    setProject({
                      ...d.original,
                      parts: d.original.parts.map((p) =>
                        p.id === d.id ? rotated : p,
                      ),
                    });
                  } else if (d.node) {
                    const [ci, ni] = d.node;
                    const a = (-original.rotation * Math.PI) / 180;
                    const dx = at.x - original.x,
                      dy = at.y - original.y;
                    const node = {
                      x: (dx * Math.cos(a) - dy * Math.sin(a)) / original.scale,
                      y: (dx * Math.sin(a) + dy * Math.cos(a)) / original.scale,
                    };
                    setProject({
                      ...d.original,
                      parts: d.original.parts.map((p) =>
                        p.id !== d.id
                          ? p
                          : {
                              ...p,
                              contours: p.contours.map((c, i) =>
                                i !== ci
                                  ? c
                                  : {
                                      ...c,
                                      points: c.points.map((v, j) =>
                                        j === ni ? node : v,
                                      ),
                                    },
                              ),
                            },
                      ),
                    });
                  } else
                    setProject({
                      ...d.original,
                      parts: d.original.parts.map((p) =>
                        p.id === d.id
                          ? {
                              ...p,
                              x: original.x + at.x - d.point.x,
                              y: original.y + at.y - d.point.y,
                            }
                          : p,
                      ),
                    });
                }}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <defs>
                  <pattern
                    id="minor"
                    width="10"
                    height="10"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 10 0 L 0 0 0 10"
                      fill="none"
                      stroke="#303a40"
                      strokeWidth="0.22"
                    />
                  </pattern>
                  <pattern
                    id="major"
                    width="50"
                    height="50"
                    patternUnits="userSpaceOnUse"
                  >
                    <rect width="50" height="50" fill="url(#minor)" />
                    <path
                      d="M 50 0 L 0 0 0 50"
                      fill="none"
                      stroke="#465057"
                      strokeWidth="0.35"
                    />
                  </pattern>
                </defs>
                <rect
                  data-layer="wazer-bed"
                  x="0"
                  y="0"
                  width={BED.width}
                  height={BED.height}
                  fill="#1c282e"
                  stroke="#6c858f"
                  strokeWidth="0.7"
                />
                <rect
                  x="0"
                  y="0"
                  width={BED.width}
                  height={BED.height}
                  fill="url(#major)"
                  pointerEvents="none"
                />
                <rect
                  data-layer="stock"
                  x={origin.x}
                  y={origin.y}
                  width={project.stock.width}
                  height={project.stock.height}
                  fill="#42514b"
                  fillOpacity="0.65"
                  stroke="#a9b6ae"
                  strokeWidth="0.5"
                />
                <rect
                  x={origin.x}
                  y={origin.y}
                  width={project.stock.width}
                  height={project.stock.height}
                  fill="url(#major)"
                />
                <rect
                  data-layer="sheet-layout"
                  x={origin.x + project.stock.margin}
                  y={origin.y + project.stock.margin}
                  width={Math.max(
                    0,
                    project.stock.width - 2 * project.stock.margin,
                  )}
                  height={Math.max(
                    0,
                    project.stock.height - 2 * project.stock.margin,
                  )}
                  fill="#1a485030"
                  stroke="#66745c"
                  strokeWidth="0.35"
                  strokeDasharray="2 2"
                />
                {Array.from(
                  { length: Math.floor(BED.width / 50) + 1 },
                  (_, i) => (
                    <text
                      className="ruler"
                      key={`x${i}`}
                      x={i * 50}
                      y="-5"
                      textAnchor="middle"
                    >
                      {i * 50}
                    </text>
                  ),
                )}
                {Array.from(
                  { length: Math.floor(BED.height / 50) + 1 },
                  (_, i) => (
                    <text
                      className="ruler"
                      key={`y${i}`}
                      x="-6"
                      y={i * 50 + 1}
                      textAnchor="end"
                    >
                      {i * 50}
                    </text>
                  ),
                )}
                <path
                  d="M -4 0 H 4 M 0 -4 V 4"
                  stroke="#eaa577"
                  strokeWidth="0.6"
                />
                <g
                  data-layer="sheet-parts"
                  transform={`translate(${origin.x} ${origin.y})`}
                >
                  {project.parts.map((p, i) => {
                    const contours = transformed(p);
                    return (
                      <g
                        key={p.id}
                        data-part-id={p.id}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setSelected(p.id);
                          setControlsId(p.id);
                          setTool("select");
                          setMode("design");
                        }}
                        onPointerDown={(e) => {
                          if (
                            definition &&
                            (tool === "tabs" || tool === "entry")
                          ) {
                            e.stopPropagation();
                            e.preventDefault();
                            const at = point(e, false);
                            const nearest = contours
                              .map((c, index) => ({
                                ...closestOnPath(c.points, c.closed, at),
                                index,
                                closed: c.closed,
                              }))
                              .filter((c) => c.closed)
                              .sort((a, b) => a.distance - b.distance)[0];
                            if (!nearest)
                              return notify(
                                "Tabs and movable entry points require a closed contour",
                              );
                            setContourIndex(nearest.index);
                            const target = p.contours[nearest.index];
                            const change =
                              tool === "tabs"
                                ? {
                                    tabMode: "manual" as const,
                                    tabs: [
                                      ...(target.tabs ?? []),
                                      {
                                        position: nearest.fraction,
                                        width: Math.max(
                                          0.1,
                                          project.material.tabWidth,
                                        ),
                                      },
                                    ],
                                  }
                                : { startPosition: nearest.fraction };
                            edit({
                              ...project,
                              parts: project.parts.map((q) =>
                                q.id === p.id
                                  ? {
                                      ...q,
                                      contours: q.contours.map((c, j) =>
                                        j === nearest.index
                                          ? { ...c, ...change }
                                          : c,
                                      ),
                                    }
                                  : q,
                              ),
                            });
                            setSelected(p.id);
                            if (tool === "entry") setTool("select");
                            return;
                          }
                          if (tool === "pen" || e.altKey || e.button === 1)
                            return;
                          e.stopPropagation();
                          e.preventDefault();
                          setSelected(p.id);
                          if (p.id !== controlsId) setControlsId(null);
                          drag.current = {
                            id: p.id,
                            point: point(e),
                            original: structuredClone(project),
                            originalJob: job,
                          };
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                      >
                        <path
                          d={contours
                            .map(
                              (c) =>
                                `M${c.points.map((v) => `${v.x},${v.y}`).join(" L")}${c.closed ? " Z" : ""}`,
                            )
                            .join(" ")}
                          fill={p.id === selected ? "#e7a66c22" : "#7d9ba014"}
                          fillRule="evenodd"
                          stroke={p.id === selected ? "#f5b174" : "#a9c6cb"}
                          strokeWidth={p.id === selected ? 0.7 : 0.45}
                          vectorEffect="non-scaling-stroke"
                          style={{ strokeWidth: p.id === selected ? 1.8 : 1.2 }}
                        />
                        {mode !== "paths" ? (
                          <text
                            className="part-label"
                            x={partBounds(p).x}
                            y={partBounds(p).y - 3}
                          >
                            {String(i + 1).padStart(2, "0")} / {p.name}
                          </text>
                        ) : null}
                        {p.id === selected && controlsId !== p.id ? (
                          <rect
                            x={partBounds(p).x - 1.5}
                            y={partBounds(p).y - 1.5}
                            width={partBounds(p).width + 3}
                            height={partBounds(p).height + 3}
                            fill="none"
                            stroke="#e5a56b"
                            strokeWidth="0.3"
                            strokeDasharray="2 1.5"
                            pointerEvents="none"
                          />
                        ) : null}
                        {tool === "nodes" && p.id === selected
                          ? contours.map((c, ci) =>
                              c.points.map((v, ni) => (
                                <circle
                                  key={`${ci}-${ni}`}
                                  cx={v.x}
                                  cy={v.y}
                                  r={1.1 / Math.sqrt(zoom)}
                                  fill="#f5b174"
                                  stroke="#20282d"
                                  strokeWidth="0.4"
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                    drag.current = {
                                      id: p.id,
                                      point: point(e),
                                      original: structuredClone(project),
                                      originalJob: job,
                                      node: [ci, ni],
                                    };
                                    svg.current?.setPointerCapture(e.pointerId);
                                  }}
                                />
                              )),
                            )
                          : null}
                      </g>
                    );
                  })}
                  {current && controlsId === current.id && tool === "select" ? (
                    <PartControls
                      part={current}
                      pixelsPerMm={pixelsPerMm}
                      view={{
                        x: -24 + pan.x - origin.x,
                        y: -22 + pan.y - origin.y,
                        width: (BED.width + 48) / zoom,
                        height: (BED.height + 44) / zoom,
                      }}
                      onDuplicate={duplicate}
                      onDelete={remove}
                      onRotate={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        e.preventDefault();
                        drag.current = {
                          id: current.id,
                          point: point(e, false),
                          original: structuredClone(project),
                          originalJob: job,
                          rotate: { center: partCenter(current) },
                        };
                        svg.current?.setPointerCapture(e.pointerId);
                      }}
                    />
                  ) : null}
                  {definition
                    ? project.parts.flatMap((p) =>
                        transformed(p).flatMap((c, ci) =>
                          (c.tabs ?? []).map((t, ti) => {
                            const at = pointOnPath(
                              c.points,
                              c.closed,
                              t.position,
                            );
                            return (
                              <g
                                key={`${p.id}-${ci}-${ti}`}
                                pointerEvents="none"
                              >
                                <circle
                                  cx={at.x}
                                  cy={at.y}
                                  r={4 / pixelsPerMm}
                                  fill="#f5ce6c"
                                  stroke="#1a242a"
                                  strokeWidth={1 / pixelsPerMm}
                                />
                                <text
                                  x={at.x + 5 / pixelsPerMm}
                                  y={at.y - 4 / pixelsPerMm}
                                  fill="#f5ce6c"
                                  fontSize={9 / pixelsPerMm}
                                >
                                  {t.width} mm
                                </text>
                              </g>
                            );
                          }),
                        ),
                      )
                    : null}
                  {definition && project.parts[0]?.contours[contourIndex] ? (
                    <path
                      d={(() => {
                        const c = transformed(project.parts[0])[contourIndex];
                        return `M${c.points.map((v) => `${v.x},${v.y}`).join(" L")}${c.closed ? " Z" : ""}`;
                      })()}
                      fill="none"
                      stroke="#8ed3d9"
                      strokeWidth={1.5 / pixelsPerMm}
                      pointerEvents="none"
                    />
                  ) : null}
                  {mode === "paths"
                    ? preview.pierces
                        .filter((p) => p.radius > 0)
                        .map((p, i) => (
                          <circle
                            key={`pierce-${i}`}
                            cx={p.point.x}
                            cy={p.point.y}
                            r={p.radius}
                            fill={p.warning ? "#f47e6d44" : "#88cabb33"}
                            stroke={p.warning ? "#f47e6d" : "#88cabb"}
                            strokeWidth={1 / pixelsPerMm}
                            pointerEvents="none"
                          />
                        ))
                    : null}
                  {mode === "paths"
                    ? visible.map((m, i) => (
                        <line
                          key={i}
                          x1={m.from.x}
                          y1={m.from.y}
                          x2={m.to.x}
                          y2={m.to.y}
                          stroke={
                            m.kind === "rapid"
                              ? "#75979f"
                              : m.kind === "tab"
                                ? "#f6ce6a"
                                : "#85c9a3"
                          }
                          strokeWidth={m.kind === "rapid" ? 0.3 : 0.65}
                          strokeDasharray={
                            m.kind === "rapid" ? "2 2" : undefined
                          }
                          pointerEvents="none"
                        />
                      ))
                    : null}
                  {mode === "paths" && visible.length ? (
                    <circle
                      cx={visible[visible.length - 1].to.x}
                      cy={visible[visible.length - 1].to.y}
                      r="2.3"
                      fill="#f5b174"
                      stroke="#fff"
                      strokeWidth="0.5"
                    />
                  ) : null}
                  {draft.length ? (
                    <polyline
                      points={draft.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="none"
                      stroke="#f5b174"
                      strokeWidth="0.8"
                    />
                  ) : null}
                </g>
              </svg>
              {tool === "pen" ? (
                <div className="canvas-help">
                  Click to add vertices · Enter to close · Shift Enter for open
                  path · Esc to cancel{" "}
                  <button onClick={() => finishPen()}>Finish path</button>
                </div>
              ) : (
                <div className="canvas-help">
                  <span className="green-dot" />
                  All geometry in millimetres{" "}
                  <span>
                    Double-click a part for rotate/actions · Alt + drag to pan
                  </span>
                </div>
              )}
              <div className="view-controls">
                <Tool
                  title="Snap to 1 mm grid"
                  active={snap}
                  onClick={() => setSnap((s) => !s)}
                >
                  <Magnet size={16} />
                </Tool>
                <span />
                <Tool
                  title="Zoom out"
                  onClick={() => setZoom((z) => Math.max(0.6, z / 1.2))}
                >
                  <ZoomOut size={16} />
                </Tool>
                <small>{Math.round(zoom * 100)}%</small>
                <Tool
                  title="Zoom in"
                  onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
                >
                  <ZoomIn size={16} />
                </Tool>
                <Tool
                  title="Fit bed"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                >
                  <Maximize size={16} />
                </Tool>
                {activeSheet ? (
                  <Tool
                    title="Fit stock"
                    onClick={() => {
                      const fit = Math.min(
                        5,
                        (BED.width + 48) / (project.stock.width + 40),
                        (BED.height + 44) / (project.stock.height + 40),
                      );
                      setZoom(fit);
                      setPan({
                        x:
                          origin.x +
                          project.stock.width / 2 -
                          (BED.width + 48) / fit / 2 +
                          24,
                        y:
                          origin.y +
                          project.stock.height / 2 -
                          (BED.height + 44) / fit / 2 +
                          22,
                      });
                    }}
                  >
                    <ScanLine size={16} />
                  </Tool>
                ) : null}
              </div>
            </div>
            {detailsOpen && (
              <section className="bottom-panel">
                <div className="bottom-tabs">
                  <button
                    className={tab === "parts" ? "active" : ""}
                    onClick={() => setTab("parts")}
                  >
                    <Layers size={14} /> Parts{" "}
                    <span>{project.parts.length}</span>
                  </button>
                  <button
                    className={tab === "issues" ? "active" : ""}
                    onClick={() => setTab("issues")}
                  >
                    <AlertTriangle size={14} /> Preflight{" "}
                    <span>{preview.issues.length}</span>
                  </button>
                  <div className="simulation">
                    <button
                      title={playing ? "Pause simulation" : "Play simulation"}
                      onClick={() => {
                        setMode("paths");
                        if (progress >= 100) setProgress(0);
                        setPlaying((v) => !v);
                      }}
                    >
                      {playing ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <input
                      aria-label="Simulation progress"
                      type="range"
                      min="0"
                      max="100"
                      value={progress}
                      onChange={(e) => {
                        setMode("paths");
                        setProgress(Number(e.target.value));
                        setPlaying(false);
                      }}
                    />
                    <small>{Math.round(progress)}%</small>
                  </div>
                </div>
                {tab === "parts" ? (
                  <div className="parts-table">
                    <div className="table-row table-header">
                      <span>#</span>
                      <span>PART NAME</span>
                      <span>SIZE (MM)</span>
                      <span>CONTOURS</span>
                      <span>CUT SIDE</span>
                    </div>
                    {project.parts.map((p, i) => (
                      <button
                        className={`table-row ${selected === p.id ? "selected" : ""}`}
                        key={p.id}
                        onClick={() => setSelected(p.id)}
                      >
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        <span>
                          <span className="part-dot" />
                          {p.name}
                        </span>
                        <span>
                          {partBounds(p).width.toFixed(1)} ×{" "}
                          {partBounds(p).height.toFixed(1)}
                        </span>
                        <span>{p.contours.length}</span>
                        <span>{p.cut}</span>
                      </button>
                    ))}
                    {!project.parts.length ? (
                      <p className="muted empty-table">
                        Your sheet is empty. Import a vector file or create a
                        shape.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="issues">
                    <p>
                      <AlertTriangle size={15} /> Preview only. WAZER machine
                      output requires a validated postprocessor.
                    </p>
                    {preview.issues.length ? (
                      preview.issues.map((s, i) => (
                        <p key={i}>
                          <AlertTriangle size={15} />
                          {s}
                        </p>
                      ))
                    ) : (
                      <p>
                        <Check size={15} />
                        No basic geometry warnings. Lead collisions,
                        self-intersections, and machine behavior are not fully
                        checked.
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
          </main>
        )}
      </div>
      <footer className="statusbar">
        <span>
          {current ? current.name : "No selection"} <i /> Grid 1 mm <i /> SVG /
          DXF
        </span>
      </footer>
      <input
        hidden
        ref={importInput}
        type="file"
        accept=".svg,.dxf"
        onChange={(e) => {
          onImport(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={openInput}
        type="file"
        accept=".json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            if (f.size > 20_000_000) throw Error("Project exceeds 20 MB");
            const loaded = readJob(JSON.parse(await f.text()));
            editJob(loaded);
            setView({ kind: "sheet", id: loaded.sheets[0].id });
            setMode("job");
            setSelected(null);
            setControlsId(null);
            lastPaste.current = { text: "", sequence: 0 };
            notify("Project opened");
          } catch (err) {
            notify(`Could not open project: ${(err as Error).message}`);
          }
        }}
      />
      <input
        hidden
        ref={libraryInput}
        type="file"
        accept=".json"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            if (file.size > 20_000_000) throw Error("Database exceeds 20 MB");
            updateLibrary(
              materialLibrarySchema.parse(JSON.parse(await file.text())),
            );
            notify("Material database imported");
          } catch (error) {
            notify((error as Error).message);
          }
        }}
      />
      {toast ? (
        <div className="toast" role="status">
          {toast}
          <button title="Dismiss" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      ) : null}
      {palette ? (
        <div className="modal-backdrop" onClick={() => setPalette(false)}>
          <div className="command-palette" onClick={(e) => e.stopPropagation()}>
            <div>
              <Command size={18} />
              <input
                autoFocus
                placeholder="Search commands…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>ESC</kbd>
            </div>
            {commands
              .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
              .map((c) => (
                <button
                  key={c.name}
                  onClick={() => {
                    setPalette(false);
                    setQuery("");
                    c.action();
                  }}
                >
                  {c.name}
                  <ChevronRight size={15} />
                </button>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { SheetPreview } from "./SheetPreview";
import { postJob, planForPosting as plan } from "../core/postprocessor";
import { PostReport, type PostReportData } from "./PostReport";
import { zipSync, strToU8 } from "fflate";
import {
  updateSheetPlacement,
  removeSheetPlacement,
  duplicateSheetPlacement,
} from "../core/sheet-placement";
import { NestingSettings } from "./NestingSettings";
import type { NestingProgress } from "../core/job-nesting";
import { MachineSettingsEditor } from "./MachineSettingsEditor";
import { defaultMachineSettings } from "../core/machine-settings";
import {
  DisplayUnitsContext,
  useDisplayUnits,
  unitFormat,
} from "./display-units";
import { PresetSelector } from "./PresetSelector";
import { workOriginPoint, originLabel } from "../core/work-origin";
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
  Briefcase,
  Database,
} from "lucide-react";
import {
  makePart,
  rectangle,
  circle,
  id,
  projectSchema,
  type Project,
  type Part,
  type Point,
} from "../core/model";
import { transformed, partBounds, nest, svgExport } from "../core/geometry";
type Mode =
  | "job"
  | "sheets"
  | "part"
  | "nest"
  | "paths"
  | "remnants"
  | "material"
  | "library"
  | "mcp"
  | "machine";
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
import { materialForMachine } from "../core/material-gauges";
import {
  initialMaterialLibrary,
  extendMaterialLibrary,
} from "../core/material-library";
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
  const u = useDisplayUnits();
  const dimensional = suffix === "mm" || suffix === "mm/min";
  const display = (n: number) => (dimensional ? u.toDisplay(n) : n);
  return (
    <label className="field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="number"
          disabled={disabled}
          min={display(min)}
          max={display(max)}
          step={display(step)}
          value={Number(display(value).toFixed(dimensional ? 5 : 3))}
          onChange={(e) => {
            const v = dimensional
              ? u.toMM(e.target.valueAsNumber)
              : e.target.valueAsNumber;
            if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
        />
        <small>{dimensional ? suffix.replace("mm", u.unit) : suffix}</small>
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
  const [job, setJob] = useState<Job>(() => newJob());
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(job));
  const [filePath, setFilePath] = useState<string | null>(null);
  const serializedJob = useMemo(() => JSON.stringify(job), [job]);
  const dirty = serializedJob !== savedSnapshot;
  const savingRef = useRef<Promise<boolean> | null>(null);
  const documentBusy = useRef(false);
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
  const cuttingArea = job.machineSettings ?? BED;
  const origin = activeSheet?.wcs ?? { x: 0, y: 0 };
  const [library, setLibrary] = useState<MaterialLibrary>(() => {
    try {
      return extendMaterialLibrary(
        materialLibrarySchema.parse(
          JSON.parse(localStorage.getItem("wam-material-library") ?? "null"),
        ),
      );
    } catch {
      return initialMaterialLibrary();
    }
  });
  const u = unitFormat(library.displayUnits ?? "mm");
  const showFileLabels = library.showFileLabels ?? true;
  const workOrigin = activeSheet
    ? workOriginPoint(activeSheet)
    : { x: 0, y: 0 };
  useEffect(() => {
    window.jobFiles?.updateViewPreferences({ units: u.unit, showFileLabels });
  }, [u.unit, showFileLabels]);
  const [libraryReady, setLibraryReady] = useState(false);
  useEffect(() => {
    if (
      !libraryReady ||
      job.machineSettings ||
      job.parts.length ||
      dirty ||
      filePath
    )
      return;
    const next = {
      ...job,
      machineSettings:
        library.machines?.[job.machine] ?? defaultMachineSettings(job.machine),
    };
    setJob(next);
    setSavedSnapshot(JSON.stringify(next));
  }, [libraryReady, job, dirty, filePath, library.machines]);
  const [contourIndex, setContourIndex] = useState(-1);
  const [partPanel, setPartPanel] = useState<"geometry" | "cuts" | "process">(
    "geometry",
  );
  const partReturn = useRef<{
    mode: Mode;
    view: JobView;
    zoom: number;
    pan: Point;
  } | null>(null);

  const rotate = job.nesting?.allowRotation ?? true;
  const [sheetToolpaths, setSheetToolpaths] = useState<Record<string, boolean>>(
    {},
  );
  const [nestingProgress, setNestingProgress] =
    useState<NestingProgress | null>(null);
  const [nestingTick, setNestingTick] = useState(0);
  const nestingStarted = useRef(0);
  const nestCheckpoint = useRef<{
    snapshot: Job;
    view: JobView;
    all: boolean;
    value: Job | Project;
  } | null>(null);
  const [nestingBusy, setNestingBusy] = useState(false);
  const nestingWorker = useRef<Worker | null>(null),
    jobRef = useRef(job);
  jobRef.current = job;
  useEffect(() => {
    if (!nestingBusy) return;
    const timer = setInterval(() => setNestingTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [nestingBusy]);
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
    [postingBusy, setPostingBusy] = useState(false),
    [postReport, setPostReport] = useState<PostReportData | null>(null),
    [palette, setPalette] = useState(false),
    [query, setQuery] = useState(""),
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
  const showCutPreview =
    mode === "paths" || (mode === "part" && partPanel !== "geometry");
  useEffect(() => {
    if (mode === "part" && !definition) {
      setMode("job");
      setSelected(null);
      setControlsId(null);
      setTool("select");
      setDraft([]);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [mode, definition?.id]);
  const preview = useMemo(() => {
    try {
      const result = plan(project);
      if (
        activeSheet &&
        (origin.x < 0 ||
          origin.y < 0 ||
          origin.x + project.stock.width > cuttingArea.width ||
          origin.y + project.stock.height > cuttingArea.height)
      )
        result.issues.push("Sheet position extends outside the WAZER bed.");
      return result;
    } catch (e) {
      return {
        moves: [],
        cutLength: 0,
        abrasiveGrams: 0,
        minutes: 0,
        issues: [String(e)],
        pierces: [],
      };
    }
  }, [project, origin.x, origin.y]);
  const material = (
    key: keyof Project["material"],
    value: number | string | boolean,
  ) => {
    if (definition) {
      const old = job.materials.find((m) => m.id === definition.materialId)!;
      const record = {
        ...old,
        id:
          job.parts.some(
            (p) => p.id !== definition.id && p.materialId === old.id,
          ) || job.sheets.some((s) => s.materialId === old.id)
            ? id()
            : old.id,
        stockKey: old.stockKey ?? old.name,
        [key]: value,
        preset: undefined,
      };
      editJob(
        setPartMaterial(
          {
            ...job,
            materials: [
              ...job.materials.filter((m) => m.id !== record.id),
              record,
            ],
          },
          definition.id,
          record.id,
        ),
      );
    } else
      edit({
        ...project,
        material: { ...project.material, [key]: value, preset: undefined },
      });
  };
  function notify(s: string) {
    setToast(s);
  }
  useEffect(() => {
    window.jobFiles?.updateViewPreferences({
      units: u.unit,
      showFileLabels,
      canPostSheet:
        activeView.kind === "sheet" &&
        !!activeSheet?.placements.length &&
        !nestingBusy &&
        !postingBusy,
      canPostAll:
        job.sheets.some((s) => s.placements.length) &&
        !nestingBusy &&
        !postingBusy,
    });
  }, [
    activeView.kind,
    activeSheet,
    job.sheets,
    nestingBusy,
    postingBusy,
    u.unit,
    showFileLabels,
  ]);
  async function post(sheetId?: string) {
    if (postingBusy || nestingBusy) return;
    setPostingBusy(true);
    try {
      const files = postJob(job, sheetId);
      let paths: string[];
      if (window.jobFiles) {
        const result = await window.jobFiles.post(job, sheetId);
        if (!result) return;
        paths = result.paths;
      } else if (sheetId) {
        download(files[0].filename, files[0].content, "text/plain");
        paths = [files[0].filename];
      } else {
        const archive = zipSync(
          Object.fromEntries(
            files.map((f) => [f.filename, strToU8(f.content)]),
          ),
        );
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(archive).buffer], {
            type: "application/zip",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "wazer-sheets.zip";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        paths = files.map((f) => f.filename + " (wazer-sheets.zip)");
      }
      setPostReport({
        title: `Posted ${files.length} sheet${files.length === 1 ? "" : "s"}`,
        files: paths,
        issues: files.flatMap((f) =>
          f.warnings.map((s) => `${f.sheetName}: ${s}`),
        ),
      });
    } catch (error) {
      setPostReport({
        title: "Cannot post job",
        issues: (error as Error).message.split("\n"),
      });
    } finally {
      setPostingBusy(false);
    }
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
  function fitPart(part?: Part) {
    const b = part?.contours.length
      ? partBounds(part)
      : { x: 0, y: 0, width: 120, height: 80 };
    const fit = Math.min(
      5,
      (BED.width + 48) / (b.width + 40),
      (BED.height + 44) / (b.height + 40),
    );
    setZoom(fit);
    setPan({
      x: b.x + b.width / 2 - (BED.width + 48) / fit / 2 + 24,
      y: b.y + b.height / 2 - (BED.height + 44) / fit / 2 + 22,
    });
  }
  function openView(next: JobView) {
    if (next.kind === "part") {
      if (mode !== "part")
        partReturn.current = { mode, view: activeView, zoom, pan };
      setPartPanel("geometry");
      fitPart(job.parts.find((p) => p.id === next.id));
    }
    if (next.kind === "sheet" && mode === "part") {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
    setView(next);
    setSelected(next.kind === "part" ? next.id : null);
    setControlsId(null);
    setDraft([]);
    setTool("select");
    setContourIndex(-1);
    setPlaying(false);
    setMode(next.kind === "part" ? "part" : "job");
  }
  function closePart() {
    const target = partReturn.current;
    setView(target?.view ?? { kind: "sheet", id: job.sheets[0].id });
    setMode(target?.mode === "part" ? "part" : "job");
    setZoom(target?.zoom ?? 1);
    setPan(target?.pan ?? { x: 0, y: 0 });
    setSelected(null);
    setDraft([]);
    setTool("select");
    setControlsId(null);
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
    record = materialForMachine(record, job.machine);
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
    if (!current) return;
    setPartPanel("geometry");
    if (definition && mode !== "part")
      openView({ kind: "part", id: definition.id });
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
  function activateJob(loaded: Job, path: string | null) {
    nestingWorker.current?.terminate();
    nestingWorker.current = null;
    setNestingBusy(false);
    setPlaying(false);
    setJob(loaded);
    setSavedSnapshot(JSON.stringify(loaded));
    setFilePath(path);
    setHistory([]);
    setFuture([]);
    setView({ kind: "sheet", id: loaded.sheets[0].id });
    setMode("job");
    setSelected(null);
    setControlsId(null);
    setDraft([]);
    setTool("select");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    lastPaste.current = { text: "", sequence: 0 };
  }
  function save(saveAs = false): Promise<boolean> {
    if (savingRef.current) return savingRef.current;
    const work = (async () => {
      const snapshot = jobSchema.parse(jobRef.current);
      try {
        if (window.jobFiles) {
          const result = await window.jobFiles.save(snapshot, saveAs);
          if (!result) return false;
          setFilePath(result.path);
        } else {
          const name = snapshot.name.replace(/[^a-z\d_-]/gi, "_") + ".wam";
          download(name, JSON.stringify(snapshot, null, 2));
          setFilePath(name);
        }
        setSavedSnapshot(JSON.stringify(snapshot));
        notify("Job saved");
        return JSON.stringify(jobRef.current) === JSON.stringify(snapshot);
      } catch (error) {
        notify("Could not save job: " + (error as Error).message);
        return false;
      }
    })();
    savingRef.current = work;
    void work.finally(() => {
      savingRef.current = null;
    });
    return work;
  }
  async function canReplaceJob() {
    if (!dirty) return true;
    if (window.jobFiles) {
      const choice = await window.jobFiles.confirmDiscard();
      if (choice === "cancel") return false;
      if (choice === "save") return save();
      return true;
    }
    return window.confirm("Discard unsaved changes to this job?");
  }
  async function documentAction(command: string) {
    if (command === "post-all") {
      void post();
      return;
    }
    if (command === "post-sheet") {
      if (activeView.kind === "sheet") void post(activeView.id);
      return;
    }
    if (command === "machine-settings") {
      setMode("machine");
      setSelected(null);
      setControlsId(null);
      setTool("select");
      return;
    }
    if (command === "units-mm" || command === "units-in") {
      updateLibrary({
        ...library,
        displayUnits: command === "units-in" ? "in" : "mm",
      });
      return;
    }
    if (command === "toggle-labels") {
      updateLibrary({ ...library, showFileLabels: !showFileLabels });
      return;
    }
    if (command === "commands") {
      setPalette(true);
      return;
    }
    if (command === "export-svg") {
      download("layout.svg", svgExport(project), "image/svg+xml");
      return;
    }

    if (command === "save" || command === "save-as") {
      await save(command === "save-as");
      return;
    }
    if (documentBusy.current) return;
    documentBusy.current = true;
    try {
      if ((command !== "open" || window.jobFiles) && !(await canReplaceJob()))
        return;
      if (command === "new") {
        await window.jobFiles?.reset();
        activateJob(
          newJob(
            job.machine,
            library.machines?.[job.machine] ??
              defaultMachineSettings(job.machine),
          ),
          null,
        );
      } else if (command === "open") {
        if (window.jobFiles) {
          const result = await window.jobFiles.open();
          if (result) activateJob(readJob(result.job), result.path);
        } else openInput.current?.click();
      } else if (command === "close") window.jobFiles?.close();
    } catch (error) {
      notify("Could not open job: " + (error as Error).message);
    } finally {
      documentBusy.current = false;
    }
  }
  function add(shape: "rect" | "circle") {
    if (mode !== "part" || !definition) {
      const result = newDefinition(
        job,
        activeSheet?.materialId ?? job.materials[0].id,
      );
      editJob({
        ...result.job,
        parts: result.job.parts.map((p) =>
          p.id === result.partId
            ? {
                ...p,
                name: shape === "rect" ? "Rectangle" : "Circle",
                contours: [shape === "rect" ? rectangle() : circle()],
              }
            : p,
        ),
      });
      openView({ kind: "part", id: result.partId });
      return;
    }

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
  function stopNest(keep: boolean) {
    const checkpoint = nestCheckpoint.current;
    nestingWorker.current?.terminate();
    nestingWorker.current = null;
    setNestingBusy(false);
    nestCheckpoint.current = null;
    if (keep && checkpoint && jobRef.current === checkpoint.snapshot) {
      editJob(
        checkpoint.all
          ? (checkpoint.value as Job)
          : editView(
              checkpoint.snapshot,
              checkpoint.view,
              checkpoint.value as Project,
            ),
      );
      setMode("job");
      setSelected(null);
      notify("Stopped search and kept the best available layout");
    } else
      notify(
        keep
          ? "Search stopped; current job kept"
          : "Search cancelled; current job kept",
      );
  }
  function runNest(all = false, sheetId?: string) {
    if (nestingBusy) return;
    const targetView: JobView = sheetId
      ? { kind: "sheet", id: sheetId }
      : activeView;
    const targetProject = sheetId ? viewProject(job, targetView) : project;
    if (all ? !job.parts.length : !targetProject.parts.length)
      return notify("Add parts first");
    if (!all && targetView.kind === "part")
      return notify("Open a sheet to nest placed copies");
    const snapshot = job,
      viewAtStart = targetView;
    nestingStarted.current = Date.now();
    setNestingTick(0);
    setNestingProgress(null);
    nestCheckpoint.current = null;
    setNestingBusy(true);
    const worker = new Worker(new URL("./nesting.worker.ts", import.meta.url), {
      type: "module",
    });
    nestingWorker.current = worker;
    const finish = () => {
      worker.terminate();
      nestingWorker.current = null;
      setNestingBusy(false);
      nestCheckpoint.current = null;
    };
    worker.onmessage = (e) => {
      if (e.data.type === "progress") {
        setNestingProgress(e.data.progress);
        if (e.data.checkpoint)
          nestCheckpoint.current = {
            snapshot,
            view: viewAtStart,
            all,
            value: e.data.checkpoint,
          };
        return;
      }
      finish();
      if (!e.data.ok) return notify(e.data.error);
      if (jobRef.current !== snapshot)
        return notify("Job changed during nesting; result was not applied");
      if (all) {
        editJob(e.data.value);
        setView({
          kind: "sheet",
          id:
            e.data.value.sheets.find(
              (s: Job["sheets"][number]) => s.placements.length,
            )?.id ?? e.data.value.sheets[0].id,
        });
      } else {
        editJob(editView(snapshot, viewAtStart, e.data.value));
        setView(viewAtStart);
      }
      setMode("job");
      setSelected(null);
      const report = e.data.report,
        remaining =
          report?.unplaced?.reduce(
            (n: number, p: { quantity: number }) => n + p.quantity,
            0,
          ) ?? 0;
      notify(
        remaining
          ? `Kept ${report.placed} of ${report.total} copies; ${remaining} remain unplaced (${report.timedOut ? "time limit reached" : report.reason === "sheet-limit" ? "sheet limit reached" : "no better placement found"}).`
          : `Nesting complete: ${report?.placed ?? project.parts.length} copies placed`,
      );
    };
    worker.onerror = () => {
      finish();
      notify("Nesting worker failed; job was preserved");
    };
    worker.postMessage({
      kind: all ? "job" : "sheet",
      value: all ? job : { ...targetProject, nesting: job.nesting },
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
    window.jobFiles?.setDirty(dirty);
    document.title = `${dirty ? "* " : ""}${job.name} — Wam Local`;
  }, [dirty, job.name, savedSnapshot, serializedJob]);
  useEffect(() =>
    window.jobFiles?.onCommand((command) => {
      void documentAction(command);
    }),
  );
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty && !window.jobFiles) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    let active = true;
    (async () => {
      let loaded = true;
      try {
        if (window.materialDatabase) {
          const db = await window.materialDatabase.load();
          if (active)
            setLibrary(extendMaterialLibrary(materialLibrarySchema.parse(db)));
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
    try {
      localStorage.setItem("wam-material-library", JSON.stringify(library));
    } catch {
      if (!window.materialDatabase)
        notify("Material presets could not be saved locally. Export a backup.");
    }
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
      if (document.querySelector("dialog[open]")) return;
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
      if (document.querySelector("dialog[open]")) return;
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
      if (document.querySelector("dialog[open]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        ["s", "o", "n"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        void documentAction(
          e.key.toLowerCase() === "s"
            ? e.shiftKey
              ? "save-as"
              : "save"
            : e.key.toLowerCase() === "o"
              ? "open"
              : "new",
        );
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
        if (mode !== "part") createPart();
        setPartPanel("geometry");
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
  async function onImport(files: File[]) {
    if (!files.length) return;
    const base = jobRef.current;
    const parts: Part[] = [],
      failures: string[] = [],
      notices: string[] = [];
    const { importSvg, importDxf } = await import("../core/import");
    for (const file of files) {
      try {
        if (file.size > 10_000_000) throw Error("File exceeds 10 MB");
        const source = await file.text();
        parts.push(
          file.name.toLowerCase().endsWith(".dxf")
            ? importDxf(source, file.name, dxfUnits, (message) =>
                notices.push(`${file.name}: ${message}`),
              )
            : importSvg(source, file.name),
        );
      } catch (error) {
        failures.push(`${file.name}: ${(error as Error).message}`);
      }
    }
    if (jobRef.current !== base) {
      notify(
        "Job changed during import. Select the files again to import into the current job.",
      );
      return;
    }
    if (parts.length) {
      if (mode === "job" || files.length > 1) {
        const materialId = activeSheet?.materialId ?? base.materials[0].id;
        editJob({
          ...base,
          parts: [
            ...base.parts,
            ...parts.map((p) => ({ ...p, materialId, quantity: 1 })),
          ],
        });
        setMode("job");
        setSelected(null);
      } else {
        edit({ ...project, parts: [...project.parts, ...parts] });
        setSelected(activeView.kind === "part" ? activeView.id : parts[0].id);
      }
    }
    notify(
      `${parts.length} of ${files.length} files imported${[...failures, ...notices].length ? " - " + [...failures, ...notices].join(" - ") : ""}`,
    );
  }
  const visible = preview.moves.slice(
    0,
    Math.ceil((preview.moves.length * progress) / 100),
  );
  const commands = [
    {
      name: "Machine settings",
      action: () => documentAction("machine-settings"),
    },
    { name: "Display units: inches", action: () => documentAction("units-in") },
    {
      name: "Display units: millimeters",
      action: () => documentAction("units-mm"),
    },
    {
      name: showFileLabels ? "Hide file labels" : "Show file labels",
      action: () => documentAction("toggle-labels"),
    },
    { name: "Import SVG / DXF", action: () => importInput.current?.click() },
    { name: "Save job", action: () => save() },
    { name: "Save job as…", action: () => save(true) },
    { name: "New job", action: () => documentAction("new") },
    { name: "Open job", action: () => documentAction("open") },
    { name: "Nest job", action: () => runNest(true) },
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
  ].filter((c) => {
    const editable =
      mode === "job" ||
      mode === "nest" ||
      (mode === "part" && partPanel === "geometry");
    if (c.name === "Copy selected part") return editable && !!current;
    if (c.name === "Paste parts") return editable;
    if (
      c.name === "Import SVG / DXF" ||
      c.name === "Add rectangle" ||
      c.name === "Add circle"
    )
      return mode === "job" || (mode === "part" && partPanel === "geometry");
    if (c.name === "Nest job")
      return (mode === "job" || mode === "nest") && job.parts.length > 0;
    if (c.name === "Export SVG layout")
      return (
        mode === "job" ||
        mode === "nest" ||
        mode === "paths" ||
        mode === "sheets"
      );
    if (c.name === "Undo") return history.length > 0 && editable;
    if (c.name === "Redo") return future.length > 0 && editable;
    return true;
  });
  return (
    <DisplayUnitsContext.Provider value={u}>
      <div className="app">
        <div className={`body ${mode === "part" ? "part-editor" : ""}`}>
          <nav className="rail">
            {(
              [
                { key: "job", icon: <Briefcase />, name: "Jobs" },
                { key: "remnants", icon: <Layers />, name: "Remnants" },
                { key: "library", icon: <Database />, name: "Presets" },
                { key: "mcp", icon: <Terminal />, name: "MCP" },
                { key: "machine", icon: <Settings2 />, name: "Machine" },
              ] as const
            ).map((item) => (
              <button
                title={item.name}
                key={item.key}
                onClick={() => {
                  if (item.key === "job" && activeView.kind === "part")
                    openView({ kind: "sheet", id: job.sheets[0].id });
                  setSelected(null);
                  setControlsId(null);
                  setTool("select");
                  setPlaying(false);
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
            {mode === "part" && (
              <div className="part-editor-context">
                <button onClick={closePart}>Done editing</button>
                <b>{definition?.name}</b>
              </div>
            )}
            <h2>
              {
                {
                  job: "Jobs",
                  sheets: "Sheets",
                  library: "Presets",
                  remnants: "Remnants",
                  part: "Part editor",
                  nest: "Sheet nesting",
                  paths: "Cut strategy",
                  material: "Material setup",
                  mcp: "MCP connection",
                  machine: "Machine settings",
                }[mode]
              }
            </h2>
            {mode === "part" && (
              <div
                className="part-editor-tabs"
                role="tablist"
                aria-label="Part editor tools"
              >
                {(
                  [
                    ["geometry", "Geometry"],
                    ["cuts", "Cuts & tabs"],
                    ["process", "Process"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={partPanel === key}
                    onClick={() => {
                      setPartPanel(key);
                      setTool("select");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {["part", "nest", "paths"].includes(mode) && (
              <label className="field workspace-switch">
                <span>
                  {mode === "part" ? "Editing part" : "Active workspace"}
                </span>
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
                  {mode !== "part" && (
                    <optgroup label="Sheets">
                      {job.sheets.map((s) => (
                        <option key={s.id} value={`sheet:${s.id}`}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {mode === "part" && (
                    <optgroup label="Part editors">
                      {job.parts.map((p) => (
                        <option key={p.id} value={`part:${p.id}`}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            )}
            {mode === "job" && (
              <section>
                <h3>REUSABLE LAYOUTS</h3>
                <button
                  onClick={() =>
                    updateLibrary({
                      ...library,
                      layouts: [
                        ...(library.layouts ?? []),
                        { id: id(), name: job.name, job: structuredClone(job) },
                      ],
                    })
                  }
                >
                  Save current layout
                </button>
                <label className="field">
                  <span>Load saved layout</span>
                  <select
                    value=""
                    onChange={async (e) => {
                      const layout = library.layouts?.find(
                        (l) => l.id === e.target.value,
                      );
                      if (layout && (await canReplaceJob())) {
                        await window.jobFiles?.reset();
                        activateJob(structuredClone(layout.job), null);
                        setSavedSnapshot("");
                      }
                    }}
                  >
                    <option value="">Select a layout...</option>
                    {library.layouts?.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
            )}
            {nestingBusy && (
              <div className="nesting-progress" role="status">
                <b>{nestingProgress?.phase ?? "Preparing nesting search"}</b>
                <p>
                  {nestingProgress?.placed ?? 0} /{" "}
                  {nestingProgress?.total ??
                    job.parts.reduce((n, p) => n + p.quantity, 0)}{" "}
                  copies placed · Pass {nestingProgress?.pass ?? 1}
                </p>
                <p>
                  {Math.floor((Date.now() - nestingStarted.current) / 1000)}s
                  elapsed
                  {nestingProgress
                    ? ` / ${Math.ceil(nestingProgress.budgetMs / 1000)}s current budget`
                    : ""}
                  {nestingProgress?.extensions
                    ? ` · ${nestingProgress.extensions} time extensions`
                    : ""}
                </p>
                <div className="button-row">
                  <button onClick={() => stopNest(true)}>
                    Stop &amp; keep best
                  </button>
                  <button onClick={() => stopNest(false)}>Cancel search</button>
                </div>
              </div>
            )}
            {mode === "remnants" ? (
              <p className="muted">
                Remnant inventory and reusable offcuts will be added here.
              </p>
            ) : mode === "mcp" ? (
              <>
                <p className="muted">
                  Use a local MCP client to create, edit, nest, and inspect
                  saved project files.
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
            ) : mode === "machine" ? (
              <p className="muted">
                Set machine geometry and consumable defaults. Saved jobs retain
                a snapshot of their settings.
              </p>
            ) : mode === "job" ? (
              <p className="muted">
                Set up your parts, quantities and cutting settings, then arrange
                them on sheets.
              </p>
            ) : mode === "sheets" ? (
              <JobPanel
                sheetsOnly
                onSelectSheet={(id) => {
                  openView({ kind: "sheet", id });
                  setMode("sheets");
                }}
                presets={[...job.materials, ...library.materials]}
                job={job}
                view={activeView}
                onChange={editJob}
                onOpen={(next) => {
                  openView(next);
                  setMode("job");
                }}
                onNewPart={createPart}
                onUpload={() => importInput.current?.click()}
                onNest={() => runNest(true)}
                onError={notify}
              />
            ) : mode === "library" ? (
              <>
                {" "}
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
                <MaterialPresets
                  project={project}
                  onApply={(p) => {
                    const record = {
                      ...p.material,
                      id: id(),
                      machine: p.machine,
                      stockKey: p.material.name,
                      name: `${p.material.name} - ${p.material.preset?.quality ?? "custom"}`,
                      source: "WAM reference capture",
                      requiresVerification: false,
                    };
                    updateLibrary({
                      ...library,
                      materials: [...library.materials, record],
                    });
                    notify("Reference preset saved to the database");
                  }}
                />
              </>
            ) : (
              <>
                <section>
                  <h3>{activeSheet ? "MACHINE & STOCK" : "PART WORKSPACE"}</h3>
                  {activeSheet && (
                    <p className="micro">
                      {activeSheet.name} - {u.number(project.stock.width)} -{" "}
                      {u.length(project.stock.height)}
                      <br />
                      Change stock and origin in Sheets.
                    </p>
                  )}
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
                      <PresetSelector
                        records={[...job.materials, ...library.materials]}
                        current={job.materials.find(
                          (m) => m.id === definition.materialId,
                        )!}
                        machine={job.machine}
                        labelSuffix="part editor"
                        onChange={(selected) => {
                          const record = materialForMachine(
                            selected,
                            job.machine,
                          );
                          const materials = job.materials.some(
                            (m) => m.id === record.id,
                          )
                            ? job.materials
                            : [...job.materials, record];
                          editJob(
                            setPartMaterial(
                              { ...job, materials },
                              definition.id,
                              record.id,
                            ),
                          );
                        }}
                      />
                    </>
                  ) : null}
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
                    <NestingSettings
                      job={job}
                      project={project}
                      scope="sheet"
                      onChange={editJob}
                      disabled={nestingBusy}
                    />
                    <button
                      disabled={nestingBusy}
                      className="primary wide"
                      onClick={() => runNest()}
                    >
                      <BoxSelect size={16} /> Nest all {project.parts.length}{" "}
                      parts
                    </button>
                    <p className="micro">
                      Nest this sheet, or use Job to fill all requested
                      quantities across sheets.
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
                        const m = job.materials.find(
                          (m) => m.id === materialId,
                        )!;
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
                {mode === "part" && definition && partPanel === "process" ? (
                  <section>
                    <h3>PROCESS PARAMETERS</h3>
                    {definition ? (
                      <>
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
                          Zero uses the kerf width automatically (
                          {u.length(project.material.kerf)}). Enter a positive
                          diameter to override it.
                        </p>
                      </>
                    ) : null}
                    <div className="notice">
                      <AlertTriangle size={17} />
                      <div>
                        <b>Preview parameters</b>
                        <p>
                          Custom and recorded reference settings are editable.
                          Post sheets from Jobs to generate WAZER cut files.
                        </p>
                      </div>
                    </div>
                  </section>
                ) : null}
                {mode === "part" && partPanel === "geometry" ? (
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
                {mode === "part" &&
                  partPanel === "cuts" &&
                  !project.parts.length && (
                    <p className="muted">
                      Draw or import an outline in Geometry before placing tabs
                      and entry points.
                    </p>
                  )}
                {mode === "part" &&
                definition &&
                project.parts[0] &&
                partPanel === "cuts" ? (
                  <>
                    <div className="field-grid">
                      <NumberField
                        label="Stock to leave"
                        value={project.parts[0].stockToLeave ?? 0}
                        min={-10}
                        max={10}
                        step={0.05}
                        onChange={(stockToLeave) =>
                          edit({
                            ...project,
                            parts: project.parts.map((p) => ({
                              ...p,
                              stockToLeave,
                            })),
                          })
                        }
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
                      Positive stock to leave enlarges the outside and reduces
                      holes; negative values do the reverse. The allowance is
                      per side. Tabs apply to closed outer contours. Leads are
                      scrap-side entries: inside holes and outside outer
                      profiles.
                    </p>
                    <label className="field">
                      <span>Part cut default</span>
                      <select
                        value={project.parts[0].cut}
                        onChange={(e) =>
                          edit({
                            ...project,
                            parts: project.parts.map((p) => ({
                              ...p,
                              cut: e.target.value as Part["cut"],
                            })),
                          })
                        }
                      >
                        <option value="outside">Outside</option>
                        <option value="inside">Inside</option>
                        <option value="centerline">Centerline</option>
                      </select>
                    </label>
                    <PartProcessEditor
                      part={project.parts[0]}
                      defaultLead={project.material.lead}
                      selected={Math.min(
                        contourIndex,
                        project.parts[0].contours.length - 1,
                      )}
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
                  </>
                ) : null}
                {(mode === "nest" ||
                  (mode === "part" && partPanel === "geometry")) && (
                  <section>
                    <h3>
                      SELECTION{" "}
                      {current ? <span className="pill">1 PART</span> : null}
                    </h3>
                    {current ? (
                      <>
                        {activeSheet && (
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={current.locked ?? false}
                              onChange={(e) =>
                                updatePart({ locked: e.target.checked })
                              }
                            />
                            Lock placement for nesting
                          </label>
                        )}
                        {definition && (
                          <label className="field">
                            <span>Nesting rotation / grain</span>
                            <select
                              value={definition.rotationPolicy ?? "free"}
                              onChange={(e) =>
                                editJob({
                                  ...job,
                                  parts: job.parts.map((p) =>
                                    p.id === definition.id
                                      ? {
                                          ...p,
                                          rotationPolicy: e.target.value as
                                            | "free"
                                            | "fixed"
                                            | "grain-x"
                                            | "grain-y",
                                        }
                                      : p,
                                  ),
                                })
                              }
                            >
                              <option value="free">Any allowed rotation</option>
                              <option value="fixed">Do not rotate</option>
                              <option value="grain-x">
                                Grain along sheet X
                              </option>
                              <option value="grain-y">
                                Grain along sheet Y
                              </option>
                            </select>
                          </label>
                        )}
                        {activeSheet && current.definitionId ? (
                          <button
                            className="wide"
                            onClick={() =>
                              openView({
                                kind: "part",
                                id: current.definitionId!,
                              })
                            }
                          >
                            Edit source part · tabs & kerf
                          </button>
                        ) : null}
                        <label className="field">
                          <span>Part name</span>
                          <input
                            value={current.name}
                            readOnly={mode !== "part"}
                            onChange={(e) =>
                              updatePart({ name: e.target.value || "Part" })
                            }
                          />
                        </label>
                        <div className="field-grid">
                          <NumberField
                            label="Position X"
                            value={current.x - workOrigin.x}
                            min={-10000}
                            onChange={(x) =>
                              updatePart({ x: x + workOrigin.x })
                            }
                          />
                          <NumberField
                            label="Position Y"
                            value={current.y - workOrigin.y}
                            min={-10000}
                            onChange={(y) =>
                              updatePart({ y: y + workOrigin.y })
                            }
                          />
                          <NumberField
                            label="Rotation"
                            value={current.rotation}
                            min={-36000}
                            max={36000}
                            suffix="deg"
                            onChange={(rotation) => updatePart({ rotation })}
                          />
                          {mode === "part" && (
                            <NumberField
                              label="Scale"
                              value={current.scale * 100}
                              min={0.1}
                              max={100000}
                              suffix="%"
                              onChange={(scale) =>
                                updatePart({ scale: scale / 100 })
                              }
                            />
                          )}
                        </div>
                        <p className="micro">
                          Bounds {u.number(partBounds(current).width)} ×{" "}
                          {u.length(partBounds(current).height)}
                        </p>

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
                )}
              </>
            )}
            <div className="inspector-footer">
              <button onClick={() => void documentAction("open")}>
                <FolderOpen size={14} />
                Open job
              </button>
              <button onClick={() => void documentAction("new")}>
                New job <Plus size={14} />
              </button>
            </div>
          </aside>
          {mode === "job" ? (
            <JobSetup
              activeSheetId={
                activeView.kind === "sheet" ? activeView.id : undefined
              }
              onClearSelection={() => {
                setSelected(null);
                setControlsId(null);
              }}
              onSelectSheet={(id) => {
                setView({ kind: "sheet", id });
                setSelected(null);
                setControlsId(null);
              }}
              renderSheetPreview={(sheet) => (
                <SheetPreview
                  job={job}
                  sheet={sheet}
                  selectedId={selected}
                  controlsId={controlsId}
                  showLabels={showFileLabels}
                  showPaths={!!sheetToolpaths[sheet.id]}
                  onShowPaths={(show) =>
                    setSheetToolpaths((p) => ({ ...p, [sheet.id]: show }))
                  }
                  disabled={nestingBusy || postingBusy}
                  onPost={post}
                  onSelect={(id, partId) => {
                    setView({ kind: "sheet", id });
                    setSelected(partId);
                  }}
                  onControls={setControlsId}
                  onTransform={(sheetId, partId, change) =>
                    editJob(updateSheetPlacement(job, sheetId, partId, change))
                  }
                  onDuplicate={(sheetId, partId) => {
                    const result = duplicateSheetPlacement(
                      job,
                      sheetId,
                      partId,
                    );
                    editJob(result.job);
                    setView({ kind: "sheet", id: sheetId });
                    setSelected(result.placementId);
                    setControlsId(result.placementId);
                  }}
                  onDelete={(sheetId, partId) => {
                    editJob(removeSheetPlacement(job, sheetId, partId));
                    setSelected(null);
                    setControlsId(null);
                  }}
                  onEdit={(id) => openView({ kind: "part", id })}
                  onNest={(id) => runNest(false, id)}
                />
              )}
              nestingPanel={
                <NestingSettings
                  job={job}
                  onChange={editJob}
                  disabled={nestingBusy}
                />
              }
              nestingBusy={nestingBusy || postingBusy}
              job={job}
              library={library}
              onChange={(next) =>
                editJob(
                  next.machine !== job.machine
                    ? {
                        ...next,
                        machineSettings:
                          library.machines?.[next.machine] ??
                          defaultMachineSettings(next.machine),
                      }
                    : next,
                )
              }
              onOpen={openView}
              onUpload={() => importInput.current?.click()}
              onNewPart={createPart}
              onNest={() => runNest(true)}
              onPost={() => void post()}
            />
          ) : mode === "machine" ? (
            <MachineSettingsEditor
              active={job.machine}
              profiles={{
                desktop:
                  library.machines?.desktop ??
                  defaultMachineSettings("desktop"),
                pro: library.machines?.pro ?? defaultMachineSettings("pro"),
                [job.machine]: job.machineSettings ?? {
                  ...defaultMachineSettings(job.machine),
                  kerf: project.material.kerf,
                  abrasive: project.material.abrasive ?? 150,
                },
              }}
              onChange={(machine, settings) => {
                updateLibrary({
                  ...library,
                  machines: {
                    desktop:
                      library.machines?.desktop ??
                      defaultMachineSettings("desktop"),
                    pro: library.machines?.pro ?? defaultMachineSettings("pro"),
                    [machine]: settings,
                  },
                });
                if (machine === job.machine)
                  editJob({ ...job, machineSettings: settings });
              }}
            />
          ) : ["library", "remnants", "mcp"].includes(mode) ? (
            <main className="workspace context-page">
              <h1>
                {mode === "library"
                  ? "Presets"
                  : mode === "remnants"
                    ? "Remnants"
                    : "MCP connection"}
              </h1>
              <p>
                {mode === "library"
                  ? "Manage material and cutting defaults in the preset database. Jobs keep their own saved settings."
                  : mode === "remnants"
                    ? "Remnant inventory will be available here."
                    : "Use the connection details to access jobs, geometry and materials through MCP."}
              </p>
            </main>
          ) : (
            <main className="workspace">
              <div className="canvas-heading">
                <div>
                  <span className="eyebrow">
                    {mode === "part" ? "PART EDITOR" : "CUTTING BED"}
                  </span>
                  <b>
                    {mode === "part" ? (
                      <>
                        {definition?.name}
                        <span>Geometry, contours and cutting settings</span>
                      </>
                    ) : (
                      <>
                        {project.machine === "desktop"
                          ? "WAZER Desktop"
                          : "WAZER Pro"}
                        <ChevronRight size={14} />
                        <span>
                          {activeSheet?.name} - {u.number(project.stock.width)}{" "}
                          - {u.length(project.stock.height)} - Origin{" "}
                          {originLabel(activeSheet?.workOrigin ?? "top-left")}
                        </span>
                      </>
                    )}
                  </b>
                </div>
                <div className="canvas-badges">
                  <button
                    onClick={() => setDetailsOpen((v) => !v)}
                    aria-expanded={detailsOpen}
                  >
                    Parts & checks
                  </button>
                  {mode === "paths" && (
                    <span>Abrasive: {preview.abrasiveGrams.toFixed(1)} g</span>
                  )}
                  <span>UNITS: {u.unit.toUpperCase()}</span>
                </div>
              </div>
              <div className="canvas-wrap">
                <div className="floating-tools">
                  <Tool
                    title="Select / move (V)"
                    disabled={
                      mode !== "nest" &&
                      !(mode === "part" && partPanel !== "process")
                    }
                    active={tool === "select"}
                    onClick={() => setTool("select")}
                  >
                    <MousePointer2 size={18} />
                  </Tool>
                  {mode === "part" && partPanel === "geometry" && (
                    <>
                      {" "}
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
                          setMode("part");
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
                    </>
                  )}
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
                      Math.max(
                        0.6,
                        Math.min(5, z * (e.deltaY > 0 ? 0.9 : 1.1)),
                      ),
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
                    if (mode === "part" && tool === "pen") {
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
                    const original = d.original.parts.find(
                      (p) => p.id === d.id,
                    )!;
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
                        x:
                          (dx * Math.cos(a) - dy * Math.sin(a)) /
                          original.scale,
                        y:
                          (dx * Math.sin(a) + dy * Math.cos(a)) /
                          original.scale,
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
                  {mode === "part" ? (
                    <rect
                      data-layer="part-editor-grid"
                      x={-24 + pan.x}
                      y={-22 + pan.y}
                      width={(BED.width + 48) / zoom}
                      height={(BED.height + 44) / zoom}
                      fill="url(#major)"
                    />
                  ) : (
                    <>
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
                        data-layer="machine-cutting-area"
                        x={0}
                        y={0}
                        width={cuttingArea.width}
                        height={cuttingArea.height}
                        fill="none"
                        stroke="#eaa577"
                        strokeDasharray="3 2"
                        strokeWidth="0.45"
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
                            x={u.number(i * 50)}
                            y="-5"
                            textAnchor="middle"
                          >
                            {u.number(i * 50)}
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
                            {u.number(i * 50)}
                          </text>
                        ),
                      )}
                      <path
                        data-layer="work-origin"
                        transform={`translate(${origin.x + workOrigin.x} ${origin.y + workOrigin.y})`}
                        d="M -4 0 H 4 M 0 -4 V 4"
                        stroke="#eaa577"
                        strokeWidth="0.6"
                      />
                    </>
                  )}
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
                            if (
                              mode !== "nest" &&
                              !(mode === "part" && partPanel === "geometry")
                            )
                              return;
                            e.stopPropagation();
                            setSelected(p.id);
                            setControlsId(p.id);
                            setTool("select");
                            if (definition) setMode("part");
                          }}
                          onPointerDown={(e) => {
                            if (
                              mode !== "nest" &&
                              !(mode === "part" && partPanel !== "process")
                            )
                              return;
                            if (
                              definition &&
                              (tool === "tabs" ||
                                tool === "entry" ||
                                partPanel === "cuts")
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
                                .filter(
                                  (c) =>
                                    (partPanel === "cuts" &&
                                      tool === "select") ||
                                    c.closed,
                                )
                                .sort((a, b) => a.distance - b.distance)[0];
                              if (!nearest)
                                return notify(
                                  "Tabs and movable entry points require a closed contour",
                                );
                              setContourIndex(nearest.index);
                              if (tool !== "tabs" && tool !== "entry") return;
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
                            style={{
                              strokeWidth: p.id === selected ? 1.8 : 1.2,
                            }}
                          />
                          {!showCutPreview && showFileLabels ? (
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
                                      svg.current?.setPointerCapture(
                                        e.pointerId,
                                      );
                                    }}
                                  />
                                )),
                              )
                            : null}
                        </g>
                      );
                    })}
                    {current &&
                    controlsId === current.id &&
                    tool === "select" ? (
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
                                    {u.length(t.width)}
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
                    {showCutPreview
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
                    {showCutPreview
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
                    {showCutPreview && visible.length ? (
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
                    Click to add vertices · Enter to close · Shift Enter for
                    open path · Esc to cancel{" "}
                    <button onClick={() => finishPen()}>Finish path</button>
                  </div>
                ) : (
                  <div className="canvas-help">
                    <span className="green-dot" />
                    Display units: {u.unit}{" "}
                    <span>
                      Double-click a part for rotate/actions · Alt + drag to pan
                    </span>
                  </div>
                )}
                <div className="view-controls">
                  <Tool
                    title={`Snap to ${u.length(1)} grid`}
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
                    title={mode === "part" ? "Fit part" : "Fit bed"}
                    onClick={() => {
                      if (mode === "part") fitPart(project.parts[0]);
                      else {
                        setZoom(1);
                        setPan({ x: 0, y: 0 });
                      }
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
                          if (activeView.kind === "part") {
                            setPartPanel("cuts");
                            setMode("part");
                          } else setMode("job");
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
                          if (activeView.kind === "part") {
                            setPartPanel("cuts");
                            setMode("part");
                          } else setMode("job");
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
                        <span>SIZE ({u.unit.toUpperCase()})</span>
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
                            {u.number(partBounds(p).width)} ×{" "}
                            {u.number(partBounds(p).height)}
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
                        <AlertTriangle size={15} /> Review cutting settings and
                        sheet placement before posting.
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
            {current ? current.name : "No selection"} <i /> Grid {u.length(1)}{" "}
            <i /> SVG / DXF
          </span>
        </footer>
        <input
          hidden
          ref={importInput}
          type="file"
          accept=".svg,.dxf"
          multiple
          onChange={(e) => {
            void onImport(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <input
          hidden
          ref={openInput}
          type="file"
          accept=".wam,.json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              if (f.size > 20_000_000) throw Error("Project exceeds 20 MB");
              const loaded = readJob(JSON.parse(await f.text()));
              if (!(await canReplaceJob())) return;
              activateJob(loaded, f.name);
              notify("Job opened");
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
        {postReport ? (
          <PostReport report={postReport} onClose={() => setPostReport(null)} />
        ) : null}
        {palette ? (
          <div className="modal-backdrop" onClick={() => setPalette(false)}>
            <div
              className="command-palette"
              onClick={(e) => e.stopPropagation()}
            >
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
                .filter((c) =>
                  c.name.toLowerCase().includes(query.toLowerCase()),
                )
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
    </DisplayUnitsContext.Provider>
  );
}

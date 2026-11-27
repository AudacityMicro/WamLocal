import { MCP_SERVER_INSTRUCTIONS } from "../core/mcp-instructions";
import { registerWorkbenchTools } from "./workbench-tools";
import { workOriginPoint, toWorkPoint } from "../core/work-origin";
import { applyNewJobDefaults } from "../core/setting-defaults";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import {
  newJob,
  readJob,
  jobSchema,
  partDefinitionSchema,
  sheetSchema,
  sheetProject,
  materialLibrarySchema,
  type Job,
} from "../core/job";
import { nestJobDetailed, jobIssues } from "../core/job-ops";
import { readLibraryFile, writeLibraryFile } from "../desktop/material-library";
import {
  projectSchema,
  partSchema,
  newProject,
  makePart,
  rectangle,
  circle,
} from "../core/model.js";
import { nest, svgExport } from "../core/geometry.js";
import { postJob, planForPosting } from "../core/postprocessor";
import { writePostedFiles } from "../desktop/post-files";
import { estimateMaterialSettings } from "../core/material-estimate";
import { jobMaterialSchema } from "../core/job";
import {
  materialPresets,
  presetIssue,
  presetSource,
  applyMaterialPreset,
} from "../core/material-presets.js";
const root = path.resolve(process.env.WAM_PROJECT_DIR || "projects");
await mkdir(root, { recursive: true });
const server = new McpServer(
  { name: "wam-local", version: "1.0.0" },
  { instructions: MCP_SERVER_INSTRUCTIONS },
);
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}
const fileSchema = z
  .string()
  .min(1)
  .max(180)
  .regex(
    /^[^\x00-\x1f<>:"/\\|?*.][^\x00-\x1f<>:"/\\|?*]*(?:\.wam|\.(?:wam|job)\.json)$/i,
  )
  .refine(
    (name) =>
      !name.includes("..") &&
      !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i.test(name),
    "Use a regular job filename",
  );
const libraryFile = path.resolve(
  process.env.WAM_MATERIAL_LIBRARY ||
    path.join(
      process.env.APPDATA || path.join(homedir(), ".config"),
      "wam-local",
      "material-library.json",
    ),
);
function file(name: string) {
  const result = path.join(root, name);
  for (const target of [result, result + ".tmp"])
    try {
      if (lstatSync(target).isSymbolicLink())
        throw Error("Job files cannot be symbolic links");
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  return result;
}
async function read(name: string) {
  return projectSchema.parse(JSON.parse(await readFile(file(name), "utf8")));
}
async function save(name: string, value: unknown) {
  const p = projectSchema.parse(value);
  const temp = file(name) + ".tmp";
  await writeFile(temp, JSON.stringify(p, null, 2), "utf8");
  await rename(temp, file(name));
  return p;
}
async function readSavedJob(name: string) {
  return readJob(JSON.parse(await readFile(file(name), "utf8")));
}
const histories = new Map<
  string,
  { undo: Job[]; redo: Job[]; expected: string }
>();
async function saveJob(name: string, value: unknown, remember = true) {
  const job = jobSchema.parse(value),
    temp = file(name) + ".tmp";
  let previous: Job | undefined;
  if (remember)
    try {
      previous = await readSavedJob(name);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  await writeFile(temp, JSON.stringify(job, null, 2), "utf8");
  await rename(temp, file(name));
  if (remember && previous) {
    const text = JSON.stringify(previous),
      h = histories.get(name);
    const undo = h?.expected === text ? h.undo : [];
    undo.push(previous);
    while (
      undo.length > 20 ||
      (undo.length > 1 && JSON.stringify(undo).length > 40000000)
    )
      undo.shift();
    histories.set(name, { undo, redo: [], expected: JSON.stringify(job) });
  }
  return job;
}
async function history(name: string, action: "undo" | "redo" | "status") {
  const current = await readSavedJob(name),
    h = histories.get(name);
  if (h && h.expected !== JSON.stringify(current)) {
    histories.delete(name);
    if (action !== "status")
      throw Error("Job changed outside this MCP session; history was cleared");
  }
  const valid = histories.get(name);
  if (action === "status")
    return { undo: valid?.undo.length ?? 0, redo: valid?.redo.length ?? 0 };
  const source = action === "undo" ? valid?.undo : valid?.redo;
  if (!valid || !source?.length) throw Error(`Nothing to ${action}`);
  const target = source[source.length - 1],
    saved = await saveJob(name, target, false);
  source.pop();
  (action === "undo" ? valid.redo : valid.undo).push(current);
  valid.expected = JSON.stringify(saved);
  return { job: saved, undo: valid.undo.length, redo: valid.redo.length };
}
const response = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});
server.tool(
  "create_project",
  "Create an offline project in the configured project folder.",
  {
    file: fileSchema,
    name: z.string().min(1),
    machine: z.enum(["desktop", "pro"]).optional(),
  },
  async ({ file, name, machine }) =>
    serial(async () => {
      const library = await readLibraryFile(libraryFile);
      const selected = machine ?? library.defaultMachine ?? "desktop";
      const p = projectSchema.parse({
        ...newProject(),
        name,
        machine: selected,
        machineSettings: library.machines?.[selected],
      });
      await writeFile(path.join(root, file), JSON.stringify(p, null, 2), {
        encoding: "utf8",
        flag: "wx",
      });
      return response(p);
    }),
);
server.tool(
  "read_project",
  "Read a project from disk. The desktop app must reopen it to see external edits.",
  { file: fileSchema },
  async ({ file }) => response(await read(file)),
);
server.tool(
  "write_project",
  "Save a complete validated project, including arbitrary vector contours, stock and material parameters. Overwrites an existing file.",
  { file: fileSchema, project: projectSchema },
  async ({ file, project }) =>
    serial(async () => response(await save(file, project))),
);
server.tool(
  "add_shape",
  "Add a rectangle (width and height) or circle (width is diameter; height unused), in millimetres.",
  {
    file: fileSchema,
    shape: z.enum(["rectangle", "circle"]),
    width: z.number().positive().max(460),
    height: z.number().positive().max(305),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
  },
  async ({ file, shape, width, height, x, y }) =>
    serial(async () => {
      const p = await read(file);
      p.parts.push(
        makePart(
          shape,
          [shape === "circle" ? circle(width / 2) : rectangle(width, height)],
          x,
          y,
        ),
      );
      return response(await save(file, p));
    }),
);
server.tool(
  "update_part",
  "Replace a part using the shared validated geometry schema.",
  { file: fileSchema, part: partSchema },
  async ({ file, part }) =>
    serial(async () => {
      const p = await read(file);
      const i = p.parts.findIndex((v) => v.id === part.id);
      if (i < 0) throw Error("Unknown part ID");
      p.parts[i] = part;
      return response(await save(file, p));
    }),
);
server.tool(
  "nest_project",
  "Nest a legacy single-sheet project using SVGnest outline placement, with an initial MaxRects candidate and independent clearance checks.",
  { file: fileSchema, rotate: z.boolean().default(true) },
  async ({ file, rotate }) =>
    serial(async () =>
      response(await save(file, nest(await read(file), rotate))),
    ),
);
server.tool(
  "inspect_toolpaths",
  "Return the posting cut operations, pierce footprints, issues and estimated time for a legacy single-sheet project.",
  { file: fileSchema },
  async ({ file }) => response(planForPosting(await read(file))),
);
server.tool(
  "export_svg",
  "Return an SVG layout with physical millimetre dimensions.",
  { file: fileSchema },
  async ({ file }) => ({
    content: [{ type: "text" as const, text: svgExport(await read(file)) }],
  }),
);
server.tool(
  "list_material_presets",
  "List exact WAM Pro Speed Mode captures. No Desktop or interpolated values. Includes outlier reasons.",
  {
    machine: z.enum(["desktop", "pro"]),
    name: z.string().optional(),
  },
  async ({ machine, name }) =>
    response({
      source: presetSource,
      presets: materialPresets
        .filter((p) => p.machine === machine && (!name || p.name === name))
        .map((p) => ({ ...p, issue: presetIssue(p) })),
    }),
);
server.tool(
  "apply_material_preset",
  "Apply an exact recorded material preset and quality to a saved project. Preserves kerf and tab count; rejects machine mismatch and outlier defaults.",
  {
    file: fileSchema,
    presetId: z.string(),
    quality: z.enum(["coarse", "medium", "fine"]),
  },
  async ({ file, presetId, quality }) =>
    serial(async () =>
      response(
        await save(
          file,
          applyMaterialPreset(await read(file), presetId, quality),
        ),
      ),
    ),
);
server.tool(
  "create_job",
  "Create a version-2 job with a part library, embedded material defaults, and an initial sheet.",
  {
    file: fileSchema,
    name: z.string().min(1).optional(),
    machine: z.enum(["desktop", "pro"]).optional(),
  },
  async ({ file: name, name: label, machine }) =>
    serial(async () => {
      const library = await readLibraryFile(libraryFile);
      const selected = machine ?? library.defaultMachine ?? "desktop";
      const defaults = applyNewJobDefaults(
        newJob(selected, library.machines?.[selected]),
        library,
      );
      const job = label
        ? { ...defaults, name: label, nameMode: "manual" as const }
        : defaults;
      await writeFile(file(name), JSON.stringify(job, null, 2), {
        encoding: "utf8",
        flag: "wx",
      });
      return response(job);
    }),
);
server.tool(
  "read_job",
  "Read a job; version-1 files are migrated in memory without changing the source file.",
  { file: fileSchema },
  async ({ file }) => response(await readSavedJob(file)),
);
server.tool(
  "write_job",
  "Save a complete validated version-2 job. Material references, quantities, placements, contour settings and WCS are validated.",
  { file: fileSchema, job: jobSchema },
  async ({ file, job }) =>
    serial(async () => response(await saveJob(file, job))),
);
server.tool(
  "add_job_part",
  "Add reusable geometry with its material and requested quantity. Empty contours are allowed for a new drawing.",
  { file: fileSchema, part: partDefinitionSchema },
  async ({ file, part }) =>
    serial(async () => {
      const job = await readSavedJob(file);
      return response(
        await saveJob(file, { ...job, parts: [...job.parts, part] }),
      );
    }),
);
server.tool(
  "update_job_part",
  "Replace a reusable part definition. Every placement uses the updated geometry and contour tab/cut settings.",
  { file: fileSchema, part: partDefinitionSchema },
  async ({ file, part }) =>
    serial(async () => {
      const job = await readSavedJob(file);
      if (!job.parts.some((p) => p.id === part.id)) throw Error("Unknown part");
      return response(
        await saveJob(file, {
          ...job,
          parts: job.parts.map((p) => (p.id === part.id ? part : p)),
        }),
      );
    }),
);
server.tool(
  "add_sheet",
  "Add a sheet. Shared jobs inherit the job material, stock size, spacing and sheet origin.",
  { file: fileSchema, sheet: sheetSchema },
  async ({ file, sheet }) =>
    serial(async () => {
      const job = await readSavedJob(file);
      return response(
        await saveJob(file, { ...job, sheets: [...job.sheets, sheet] }),
      );
    }),
);
server.tool(
  "update_sheet",
  "Replace a sheet including placements and WCS. In shared jobs, material, stock dimensions, spacing and sheet origin update every sheet and part; placements remain per sheet.",
  { file: fileSchema, sheet: sheetSchema },
  async ({ file, sheet }) =>
    serial(async () => {
      const job = await readSavedJob(file);
      if (!job.sheets.some((s) => s.id === sheet.id))
        throw Error("Unknown sheet");
      return response(
        await saveJob(file, {
          ...job,
          sheets: job.sheets.map((s) => {
            const next = s.id === sheet.id ? sheet : s;
            return job.sharedSetup
              ? {
                  ...next,
                  materialId: sheet.materialId,
                  workOrigin: sheet.workOrigin,
                  workOriginReference: sheet.workOriginReference,
                  stock: {
                    ...next.stock,
                    width: sheet.stock.width,
                    height: sheet.stock.height,
                    margin: sheet.stock.margin,
                    spacing: sheet.stock.spacing,
                  },
                }
              : next;
          }),
        }),
      );
    }),
);
server.tool(
  "nest_job",
  "Nest requested quantities in material-compatible batches with adaptive or fixed time limits. Saves the best validated layout, including partial results, and returns nestingResult with unplaced quantities and the stop reason. Locked placements remain fixed.",
  {
    file: fileSchema,
    rotate: z.boolean().optional(),
    settings: projectSchema.shape.nesting.optional(),
  },
  async ({ file, rotate, settings }) =>
    serial(async () => {
      const original = await readSavedJob(file);
      const { job, ...nestingResult } = nestJobDetailed(
        settings ? { ...original, nesting: settings } : original,
        rotate,
      );
      const saved = await saveJob(file, job);
      return response({ ...saved, nestingResult });
    }),
);
server.tool(
  "inspect_job",
  "Return per-sheet posting paths, separate pierces around tab gaps, WCS and preflight. post_sheet and post_all write WAZER NC files.",
  { file: fileSchema },
  async ({ file }) => {
    const job = await readSavedJob(file);
    return response({
      issues: jobIssues(job, planForPosting),
      sheets: job.sheets.map((s) => {
        const preview = planForPosting(sheetProject(job, s.id));
        return {
          id: s.id,
          name: s.name,
          wcs: s.wcs,
          ...preview,
          bedMoves: preview.moves.map((m) => ({
            ...m,
            from: { x: m.from.x + s.wcs.x, y: m.from.y + s.wcs.y },
            to: { x: m.to.x + s.wcs.x, y: m.to.y + s.wcs.y },
          })),
        };
      }),
    });
  },
);
server.tool(
  "read_material_library",
  "Read the local material/preset database configured with WAM_MATERIAL_LIBRARY; uses the desktop user-data path by default on Windows.",
  {},
  async () => response(await readLibraryFile(libraryFile)),
);
server.tool(
  "write_material_library",
  "Replace editable material defaults. Existing jobs retain their embedded snapshots until explicitly changed.",
  { library: materialLibrarySchema },
  async ({ library }) =>
    serial(async () => response(await writeLibraryFile(libraryFile, library))),
);
for (const all of [false, true])
  server.tool(
    all ? "post_all" : "post_sheet",
    all
      ? "Post every populated sheet as a separate WAZER .gcode file in the project folder. Validate the whole batch before writing. Does not operate the machine."
      : "Post one sheet as a WAZER .gcode file in the project folder. Does not operate the machine.",
    all
      ? { file: fileSchema, replace: z.boolean().default(false) }
      : {
          file: fileSchema,
          sheetId: z.string().min(1),
          replace: z.boolean().default(false),
        },
    async (args) =>
      serial(async () => {
        const files = postJob(
          await readSavedJob(args.file),
          "sheetId" in args ? (args.sheetId as string) : undefined,
        );
        const paths = await writePostedFiles(root, files, args.replace);
        return response({ paths, sheets: files.map(({ content, ...f }) => f) });
      }),
  );
server.tool(
  "estimate_material_settings",
  "Return exact recorded settings or a same-machine, bracketed custom-thickness estimate. No extrapolation or cross-machine scaling. Does not modify a job.",
  {
    material: jobMaterialSchema,
    thicknessMm: z.number().positive(),
    quality: z.enum(["coarse", "medium", "fine"]),
  },
  async ({ material, thicknessMm, quality }) =>
    response(estimateMaterialSettings(material, thicknessMm, quality)),
);
registerWorkbenchTools(server, {
  root,
  location: file,
  fileSchema,
  read: readSavedJob,
  save: saveJob,
  readLibrary: () => readLibraryFile(libraryFile),
  writeLibrary: (value) => writeLibraryFile(libraryFile, value),
  serial,
  history,
});
await server.connect(new StdioServerTransport());

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
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
import { nestJob, jobIssues } from "../core/job-ops";
import { readLibraryFile, writeLibraryFile } from "../desktop/material-library";
import {
  projectSchema,
  partSchema,
  newProject,
  makePart,
  rectangle,
  circle,
} from "../core/model.js";
import { nest, plan, svgExport } from "../core/geometry.js";
import {
  materialPresets,
  presetIssue,
  presetSource,
  applyMaterialPreset,
} from "../core/material-presets.js";
const root = path.resolve(process.env.WAM_PROJECT_DIR || "projects");
await mkdir(root, { recursive: true });
const server = new McpServer({ name: "wam-local", version: "0.2.0" });
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}
const fileSchema = z.string().regex(/^[a-zA-Z0-9_-]+\.(wam|job)\.json$/);
const libraryFile = path.resolve(
  process.env.WAM_MATERIAL_LIBRARY ||
    path.join(
      process.env.APPDATA || path.join(homedir(), ".config"),
      "wam-local",
      "material-library.json",
    ),
);
function file(name: string) {
  return path.join(root, name);
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
async function saveJob(name: string, value: unknown) {
  const job = jobSchema.parse(value),
    temp = file(name) + ".tmp";
  await writeFile(temp, JSON.stringify(job, null, 2), "utf8");
  await rename(temp, file(name));
  return job;
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
    machine: z.enum(["desktop", "pro"]),
  },
  async ({ file, name, machine }) =>
    serial(async () => {
      const p = projectSchema.parse({ ...newProject(), name, machine });
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
  "Return preview cut moves, issues and approximate cut time. Not a validated WAZER postprocessor.",
  { file: fileSchema },
  async ({ file }) => response(plan(await read(file))),
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
    name: z.string().min(1),
    machine: z.enum(["desktop", "pro"]),
  },
  async ({ file: name, name: label, machine }) =>
    serial(async () => {
      const job = { ...newJob(machine), name: label };
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
  "Add a sheet with stock dimensions, a material and an X/Y WCS origin.",
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
  "Replace a sheet including placements and WCS. Incompatible materials and excess quantities are rejected.",
  { file: fileSchema, sheet: sheetSchema },
  async ({ file, sheet }) =>
    serial(async () => {
      const job = await readSavedJob(file);
      if (!job.sheets.some((s) => s.id === sheet.id))
        throw Error("Unknown sheet");
      return response(
        await saveJob(file, {
          ...job,
          sheets: job.sheets.map((s) => (s.id === sheet.id ? sheet : s)),
        }),
      );
    }),
);
server.tool(
  "nest_job",
  "Nest all requested part quantities across compatible sheets using SVGnest; create more sheets when required. Replaces current placements only after a complete successful search.",
  { file: fileSchema, rotate: z.boolean().default(true) },
  async ({ file, rotate }) =>
    serial(async () =>
      response(await saveJob(file, nestJob(await readSavedJob(file), rotate))),
    ),
);
server.tool(
  "inspect_job",
  "Return per-sheet preview paths, pierce footprints, WCS and job preflight. Bed coordinates are preview coordinates, not machine-ready NC.",
  { file: fileSchema },
  async ({ file }) => {
    const job = await readSavedJob(file);
    return response({
      issues: jobIssues(job),
      sheets: job.sheets.map((s) => {
        const preview = plan(sheetProject(job, s.id));
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
await server.connect(new StdioServerTransport());

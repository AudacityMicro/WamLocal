import { z } from "zod";
import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  jobSchema,
  jobMaterialSchema,
  partDefinitionSchema,
  sheetSchema,
  sheetProject,
  viewProject,
  placedCount,
  type Job,
  type MaterialLibrary,
} from "../core/job";
import {
  id,
  makePart,
  rectangle,
  circle,
  contourSchema,
  pointSchema,
  tabRulesSchema,
  nestingSchema,
} from "../core/model";
import {
  setPartQuantity,
  placeDefinition,
  setJobMaterial,
  changeJobMachine,
  editView,
} from "../core/job-ops";
import {
  newPartDefaults,
  newContourDefaults,
  matchingDefaultMaterial,
  saveSettingDefault,
  resolveSettingDefault,
} from "../core/setting-defaults";
import {
  defaultMachineSettings,
  machineSettingsSchema,
} from "../core/machine-settings";
import {
  importSettingsSchema,
  defaultImportSettings,
} from "../core/import-settings";
import { nest } from "../core/geometry";
import { svgExport } from "../core/geometry";
import { deleteMaterialPreset } from "../core/material-library";
import { saveJobMaterialProfiles } from "../core/job-material-actions";
import { parseSimulation, simulationAt } from "../core/gcode-simulation";
import { postJob } from "../core/postprocessor";
import { planForPosting } from "../core/postprocessor";
import { materialName, materialQuality } from "../core/material-selection";
import {
  materialHierarchy,
  MATERIAL_FAMILIES,
} from "../core/material-hierarchy";
import { selectStepFace } from "../core/step-import";
import { importDrawing } from "./import-drawing";
import { NestingSessions } from "./nesting-sessions";

type Context = {
  root: string;
  location(name: string): string;
  fileSchema: z.ZodString;
  read(name: string): Promise<Job>;
  save(name: string, job: unknown): Promise<Job>;
  readLibrary(): Promise<MaterialLibrary>;
  writeLibrary(library: unknown): Promise<MaterialLibrary>;
  serial<T>(operation: () => Promise<T>): Promise<T>;
  history(name: string, action: "undo" | "redo" | "status"): Promise<unknown>;
};
const response = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});
const key = z.string().min(1).max(200),
  machine = z.enum(["desktop", "pro"]);
const value = z.union([z.number().finite(), z.string(), z.boolean(), z.null()]);
export function registerWorkbenchTools(server: McpServer, c: Context) {
  const searches = new NestingSessions(c);
  const file = c.fileSchema;
  server.tool(
    "start_nesting",
    "Start a background job search, or a single-sheet search with sheetId. Returns immediately with searchId. Poll nesting_status; completion saves automatically only if the source job is unchanged. stop_nesting can cancel or keep the best checkpoint.",
    {
      file,
      sheetId: key.optional(),
      rotate: z.boolean().optional(),
      settings: nestingSchema.partial().optional(),
    },
    async (a) =>
      c.serial(async () => {
        const original = await c.read(a.file);
        const input = a.settings
          ? jobSchema.parse({
              ...original,
              nesting: { ...original.nesting, ...a.settings },
            })
          : original;
        return response(
          await searches.start(a.file, input, a.rotate, a.sheetId, original),
        );
      }),
  );
  server.tool(
    "nesting_status",
    "Read background nesting progress and final report by searchId. Does not block the search. Reopen/read the job after saved=true.",
    { searchId: key },
    async (a) => response(searches.status(a.searchId)),
  );
  server.tool(
    "stop_nesting",
    "Stop a background search. keepBest=true saves its latest validated checkpoint if the original file is unchanged; false cancels without changing the job.",
    { searchId: key, keepBest: z.boolean().default(false) },
    async (a) =>
      c.serial(async () =>
        response(await searches.stop(a.searchId, a.keepBest)),
      ),
  );
  const mutate = async (name: string, fn: (job: Job) => Job | Promise<Job>) =>
    response(await c.save(name, await fn(await c.read(name))));
  const part = (job: Job, partId: string) => {
    const p = job.parts.find((p) => p.id === partId);
    if (!p) throw Error("Unknown part ID");
    return p;
  };
  const sheet = (job: Job, sheetId: string) => {
    const s = job.sheets.find((s) => s.id === sheetId);
    if (!s) throw Error("Unknown sheet ID");
    return s;
  };
  const record = async (materialId: string) => {
    const m = (await c.readLibrary()).materials.find(
      (m) => m.id === materialId,
    );
    if (!m) throw Error("Unknown material preset ID");
    return m;
  };

  server.tool(
    "query_material_presets",
    "Find shared profiles by machine, material family/class/name, thickness and quality. Paginated results avoid reading the entire database. Thickness is mm.",
    {
      machine: machine.optional(),
      family: z.enum(MATERIAL_FAMILIES).optional(),
      materialClass: z.string().optional(),
      name: z.string().optional(),
      thickness: z.number().positive().optional(),
      quality: z.enum(["coarse", "medium", "fine", "custom"]).optional(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async (a) => {
      const matches = (await c.readLibrary()).materials.filter((m) => {
        const h = materialHierarchy(m);
        return (
          (!a.machine || m.machine === a.machine) &&
          (!a.family || h.family === a.family) &&
          (!a.materialClass ||
            h.materialClass.toLowerCase() === a.materialClass.toLowerCase()) &&
          (!a.name ||
            materialName(m).toLowerCase().includes(a.name.toLowerCase())) &&
          (a.thickness === undefined ||
            Math.abs(m.thickness - a.thickness) < 0.0001) &&
          (!a.quality || materialQuality(m) === a.quality)
        );
      });
      return response({
        total: matches.length,
        materials: matches.slice(a.offset, a.offset + a.limit),
        nextOffset:
          a.offset + a.limit < matches.length ? a.offset + a.limit : null,
      });
    },
  );
  server.tool(
    "list_workspace",
    "List saved jobs, importable drawings and posted files in WAM_PROJECT_DIR. Does not read outside that directory.",
    {},
    async () => {
      const entries = await readdir(c.root, { withFileTypes: true });
      return response({
        folder: c.root,
        files: entries
          .filter(
            (e) =>
              e.isFile() &&
              /\.(wam|json|svg|dxf|step|stp|png|jpe?g|gif|webp|bmp|gcode)$/i.test(
                e.name,
              ),
          )
          .map((e) => e.name),
      });
    },
  );
  server.tool(
    "save_job_as",
    "Save a copy under another job filename. Existing targets require replace=true. The original remains unchanged.",
    { file, target: file, replace: z.boolean().default(false) },
    async (a) =>
      c.serial(async () => {
        const job = await c.read(a.file);
        if (a.replace) await c.save(a.target, job);
        else
          await writeFile(c.location(a.target), JSON.stringify(job, null, 2), {
            encoding: "utf8",
            flag: "wx",
          });
        return response({ file: a.target, job });
      }),
  );
  server.tool(
    "configure_job",
    "Change name/automatic naming, machine, material, shared stock size/spacing/origin, job tabs, lead-ins or nesting. Partial fields preserve other settings. Changing machine applies matching profiles; selecting material must match the resulting machine.",
    {
      file,
      name: z.string().min(1).optional(),
      automaticName: z.boolean().optional(),
      machine: machine.optional(),
      materialId: key.optional(),
      stock: sheetSchema.shape.stock.partial().optional(),
      workOrigin: sheetSchema.shape.workOrigin.optional(),
      workOriginReference: sheetSchema.shape.workOriginReference.optional(),
      tabRules: tabRulesSchema.partial().optional(),
      lead: z.number().min(0).max(30).optional(),
      leadStyle: z.enum(["arc", "straight"]).optional(),
      nesting: nestingSchema.partial().optional(),
    },
    async (a) =>
      c.serial(() =>
        mutate(a.file, async (job) => {
          if (a.machine)
            job = changeJobMachine(job, a.machine, await c.readLibrary());
          if (a.materialId) {
            const m = await record(a.materialId);
            if (m.machine !== job.machine)
              throw Error("Material must match the job machine");
            job = setJobMaterial(job, m);
          }
          if (a.name !== undefined)
            job = { ...job, name: a.name, nameMode: "manual" };
          if (a.automaticName !== undefined)
            job = { ...job, nameMode: a.automaticName ? "auto" : "manual" };
          const active = job.sheets[0].materialId;
          return jobSchema.parse({
            ...job,
            sharedSetup: true,
            nesting: a.nesting ? { ...job.nesting, ...a.nesting } : job.nesting,
            tabRules: a.tabRules
              ? {
                  ...job.tabRules,
                  ...a.tabRules,
                  ...(a.tabRules.width !== undefined &&
                  a.tabRules.automaticWidth === undefined
                    ? { automaticWidth: false }
                    : {}),
                }
              : job.tabRules,
            materials: job.materials.map((m) =>
              m.id === active
                ? {
                    ...m,
                    ...(a.lead !== undefined ? { lead: a.lead } : {}),
                    ...(a.leadStyle ? { leadStyle: a.leadStyle } : {}),
                  }
                : m,
            ),
            sheets: job.sheets.map((s) => ({
              ...s,
              stock: { ...s.stock, ...a.stock },
              workOrigin: a.workOrigin ?? s.workOrigin,
              workOriginReference:
                a.workOriginReference ?? s.workOriginReference,
            })),
          });
        }),
      ),
  );
  server.tool(
    "create_part",
    "Create a reusable empty part or rectangle/circle/polyline, using the job material and saved part defaults. Dimensions and coordinates are mm.",
    {
      file,
      name: z.string().min(1),
      quantity: z.number().int().min(0).max(2000).default(1),
      shape: z
        .enum(["empty", "rectangle", "circle", "polyline"])
        .default("empty"),
      width: z.number().positive().max(10000).optional(),
      height: z.number().positive().max(10000).optional(),
      points: z.array(pointSchema).min(2).max(20000).optional(),
      closed: z.boolean().default(true),
    },
    async (a) =>
      c.serial(() =>
        mutate(a.file, async (job) => {
          let contours: ReturnType<typeof contourSchema.parse>[] = [];
          if (a.shape === "rectangle") {
            if (!a.width || !a.height)
              throw Error("Rectangle requires width and height");
            contours = [rectangle(a.width, a.height)];
          }
          if (a.shape === "circle") {
            if (!a.width) throw Error("Circle requires width (diameter)");
            contours = [circle(a.width / 2)];
          }
          if (a.shape === "polyline") {
            if (!a.points) throw Error("Polyline requires points");
            contours = [
              contourSchema.parse({ points: a.points, closed: a.closed }),
            ];
          }
          const snapshot = job.materials.find(
              (m) => m.id === job.sheets[0].materialId,
            )!,
            m =
              matchingDefaultMaterial(await c.readLibrary(), snapshot) ??
              snapshot;
          // Empty definitions are valid job parts, whereas makePart requires contours.
          const p = contours.length
            ? newPartDefaults(makePart(a.name, contours), m)
            : {
                id: id(),
                name: a.name,
                contours: [],
                x: 0,
                y: 0,
                rotation: 0,
                scale: 1,
                cut: m.settingDefaults?.cut ?? "outside",
                stockToLeave: m.settingDefaults?.stockToLeave ?? 0,
              };
          return jobSchema.parse({
            ...job,
            parts: [
              ...job.parts,
              { ...p, materialId: snapshot.id, quantity: a.quantity },
            ],
          });
        }),
      ),
  );
  server.tool(
    "edit_part",
    "Patch part name, quantity, scale/rotation, grain policy, stock-to-leave and process overrides without replacing unrelated geometry. resetFields removes optional overrides.",
    {
      file,
      partId: key,
      stepFaceId: z.string().optional(),
      changes: partDefinitionSchema
        .omit({ id: true, materialId: true, contours: true, stepSource: true })
        .partial(),
      resetFields: z
        .array(z.enum(["stockToLeave", "process", "rotationPolicy", "locked"]))
        .default([]),
    },
    async (a) =>
      c.serial(() =>
        mutate(a.file, (job) => {
          const current = part(job, a.partId);
          if (a.changes.quantity !== undefined)
            job = setPartQuantity(job, current.id, a.changes.quantity);
          const existing = part(job, a.partId);
          const next = {
            ...(a.stepFaceId
              ? selectStepFace(existing, a.stepFaceId)
              : existing),
            ...a.changes,
          };
          for (const key of a.resetFields) delete next[key];
          return jobSchema.parse({
            ...job,
            parts: job.parts.map((p) => (p.id === a.partId ? next : p)),
          });
        }),
      ),
  );
  server.tool(
    "edit_contour",
    "Add, patch or delete a contour by zero-based index. Patch points for node editing; tabs with position/width, startPosition, lead, cut and hole set the same graphical cut controls as the editor. resetFields restores inherited optional settings.",
    {
      file,
      partId: key,
      action: z.enum(["add", "update", "delete"]),
      contourIndex: z.number().int().nonnegative().optional(),
      changes: contourSchema.partial().optional(),
      resetFields: z
        .array(
          z.enum([
            "cut",
            "tabMode",
            "tabs",
            "lead",
            "leadInOverlap",
            "leadOutOverlap",
            "startPosition",
          ]),
        )
        .default([]),
    },
    async (a) =>
      c.serial(() =>
        mutate(a.file, (job) => {
          const p = part(job, a.partId),
            contours = structuredClone(p.contours);
          if (a.action === "add")
            contours.push(
              newContourDefaults(
                contourSchema.parse(a.changes),
                job.materials.find((m) => m.id === p.materialId)!,
              ),
            );
          else {
            if (a.contourIndex === undefined || !contours[a.contourIndex])
              throw Error("Unknown contour index");
            if (a.action === "delete") contours.splice(a.contourIndex, 1);
            else {
              const next = { ...contours[a.contourIndex], ...a.changes };
              for (const k of a.resetFields) delete next[k];
              contours[a.contourIndex] = contourSchema.parse(next);
            }
          }
          return jobSchema.parse({
            ...job,
            parts: job.parts.map((v) =>
              v.id === p.id ? { ...v, contours } : v,
            ),
          });
        }),
      ),
  );
  server.tool(
    "delete_parts",
    "Delete source definitions and all their sheet placements. Undo is available during this server session.",
    { file, partIds: z.array(key).min(1).max(2000) },
    async (a) =>
      c.serial(() =>
        mutate(a.file, (job) => {
          a.partIds.forEach((i) => part(job, i));
          const ids = new Set(a.partIds);
          return jobSchema.parse({
            ...job,
            parts: job.parts.filter((p) => !ids.has(p.id)),
            sheets: job.sheets.map((s) => ({
              ...s,
              placements: s.placements.filter((p) => !ids.has(p.partId)),
            })),
          });
        }),
      ),
  );
  server.tool(
    "duplicate_parts",
    "Copy/paste reusable part definitions, including contours, tabs and process overrides, with new IDs. Copies start unplaced.",
    {
      file,
      partIds: z.array(key).min(1).max(2000),
      copies: z.number().int().min(1).max(100).default(1),
    },
    async (a) =>
      c.serial(() =>
        mutate(a.file, (job) => {
          const originals = a.partIds.map((i) => part(job, i));
          return jobSchema.parse({
            ...job,
            parts: [
              ...job.parts,
              ...Array.from({ length: a.copies }, () =>
                originals.map((p) => ({
                  ...structuredClone(p),
                  id: id(),
                  name: p.name + " copy",
                })),
              ).flat(),
            ],
          });
        }),
      ),
  );
  server.tool(
    "place_part",
    "Place an unplaced requested copy on a sheet at optional X/Y, rotation, scale and lock state.",
    {
      file,
      partId: key,
      sheetId: key,
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      rotation: z.number().finite().optional(),
      scale: z.number().positive().max(1000).optional(),
      locked: z.boolean().optional(),
    },
    async (a) =>
      c.serial(() =>
        mutate(a.file, (job) => {
          const next = placeDefinition(job, a.partId, a.sheetId);
          return jobSchema.parse({
            ...next,
            sheets: next.sheets.map((s) =>
              s.id === a.sheetId
                ? {
                    ...s,
                    placements: s.placements.map((p, i) =>
                      i === s.placements.length - 1
                        ? {
                            ...p,
                            ...Object.fromEntries(
                              ["x", "y", "rotation", "scale", "locked"]
                                .filter((k) => (a as any)[k] !== undefined)
                                .map((k) => [k, (a as any)[k]]),
                            ),
                          }
                        : p,
                    ),
                  }
                : s,
            ),
          });
        }),
      ),
  );
  server.tool(
    "edit_placements",
    "Move/rotate/scale/lock a multi-selection, delete placements, or copy/paste them with new IDs. Transform adds dx/dy/rotationDelta; scale sets absolute scale. Duplicate increases requested quantities to accommodate the new copies.",
    {
      file,
      sheetId: key,
      placementIds: z.array(key).min(1).max(2000),
      action: z.enum(["transform", "delete", "duplicate"]),
      dx: z.number().finite().default(0),
      dy: z.number().finite().default(0),
      rotationDelta: z.number().finite().default(0),
      scale: z.number().positive().max(1000).optional(),
      locked: z.boolean().optional(),
    },
    async (a) =>
      c.serial(() =>
        mutate(a.file, (job) => {
          const s = sheet(job, a.sheetId),
            ids = new Set(a.placementIds);
          if ([...ids].some((i) => !s.placements.some((p) => p.id === i)))
            throw Error("Unknown placement ID");
          const transform = (p: (typeof s.placements)[number]) => ({
            ...p,
            x: p.x + a.dx,
            y: p.y + a.dy,
            rotation: p.rotation + a.rotationDelta,
            ...(a.scale !== undefined ? { scale: a.scale } : {}),
            ...(a.locked !== undefined ? { locked: a.locked } : {}),
          });
          const extra =
            a.action === "duplicate"
              ? s.placements
                  .filter((p) => ids.has(p.id))
                  .map((p) => ({ ...transform(p), id: id() }))
              : [];
          return jobSchema.parse({
            ...job,
            parts: job.parts.map((p) => ({
              ...p,
              quantity: Math.max(
                p.quantity,
                placedCount(job, p.id) +
                  extra.filter((e) => e.partId === p.id).length,
              ),
            })),
            sheets: job.sheets.map((v) =>
              v.id === s.id
                ? {
                    ...v,
                    placements: [
                      ...v.placements
                        .filter((p) => a.action !== "delete" || !ids.has(p.id))
                        .map((p) =>
                          a.action === "transform" && ids.has(p.id)
                            ? transform(p)
                            : p,
                        ),
                      ...extra,
                    ],
                  }
                : v,
            ),
          });
        }),
      ),
  );
  server.tool(
    "remove_sheet",
    "Remove a sheet and return its copies to unplaced quantities. The last sheet cannot be removed.",
    { file, sheetId: key },
    async (a) =>
      c.serial(() =>
        mutate(a.file, (job) => {
          sheet(job, a.sheetId);
          if (job.sheets.length === 1) throw Error("Keep at least one sheet");
          return jobSchema.parse({
            ...job,
            sheets: job.sheets.filter((s) => s.id !== a.sheetId),
          });
        }),
      ),
  );
  server.tool(
    "nest_sheet",
    "Re-nest the copies already assigned to one sheet, preserving locks and job nesting settings. Does not move copies from other sheets.",
    { file, sheetId: key, rotate: z.boolean().default(true) },
    async (a) =>
      c.serial(() =>
        mutate(a.file, (job) => {
          sheet(job, a.sheetId);
          return editView(
            job,
            { kind: "sheet", id: a.sheetId },
            nest(sheetProject(job, a.sheetId), a.rotate),
          );
        }),
      ),
  );
  server.tool(
    "apply_job_material",
    "Apply a shared preset snapshot to every part and sheet. Rejects cross-machine profiles. For custom thickness use estimate_material_settings, then write_job with the estimated material.",
    { file, materialId: key },
    async (a) =>
      c.serial(() =>
        mutate(a.file, async (job) => {
          const m = await record(a.materialId);
          if (m.machine !== job.machine) throw Error("Preset machine mismatch");
          return setJobMaterial(job, m);
        }),
      ),
  );
  server.tool(
    "edit_material_preset",
    "Create, duplicate, patch or delete a shared material profile. Setting jobFile also applies a created/updated profile to that job. Unrelated saved jobs retain snapshots.",
    {
      action: z.enum(["create", "duplicate", "update", "delete"]),
      materialId: key.optional(),
      material: jobMaterialSchema.optional(),
      changes: jobMaterialSchema.omit({ id: true }).partial().optional(),
      jobFile: file.optional(),
    },
    async (a) =>
      c.serial(async () => {
        let library = await c.readLibrary();
        const old = a.materialId
          ? library.materials.find((m) => m.id === a.materialId)
          : undefined;
        if (a.action !== "create" && !old) throw Error("Unknown preset ID");
        if (a.action === "delete") {
          if (a.jobFile) throw Error("Cannot apply a deleted profile");
          library = deleteMaterialPreset(library, old!.id);
          return response(await c.writeLibrary(library));
        }
        const m = jobMaterialSchema.parse(
          a.action === "create"
            ? a.material
            : {
                ...old,
                ...a.changes,
                id: a.action === "duplicate" ? id() : old!.id,
                source: "User-edited defaults",
                preset: undefined,
              },
        );
        if (
          a.action === "create" &&
          library.materials.some((p) => p.id === m.id)
        )
          throw Error("Preset ID already exists");
        if (a.jobFile) {
          const result = saveJobMaterialProfiles(
            library,
            await c.read(a.jobFile),
            [m],
            m.id,
          );
          await c.writeLibrary(result.library);
          return response({
            material: m,
            job: await c.save(a.jobFile, result.job),
          });
        }
        library = {
          ...library,
          materials: [...library.materials.filter((p) => p.id !== m.id), m],
          deletedMaterialIds: library.deletedMaterialIds?.filter(
            (i) => i !== m.id,
          ),
        };
        return response({
          material: m,
          library: await c.writeLibrary(library),
        });
      }),
  );
  server.tool(
    "application_settings",
    "Read or patch shared machine defaults, costs, display units, file labels, import tolerance/tracing and saved defaults. resetMachine restores factory settings. Optional jobFile applies the selected machine profile to that job.",
    {
      displayUnits: z.enum(["mm", "in"]).optional(),
      showFileLabels: z.boolean().optional(),
      defaultMachine: machine.optional(),
      machine: machine.optional(),
      machineSettings: machineSettingsSchema.partial().optional(),
      resetMachine: z.boolean().default(false),
      importSettings: importSettingsSchema.partial().optional(),
      resetImport: z.boolean().default(false),
      jobFile: file.optional(),
    },
    async (a) =>
      c.serial(async () => {
        let library = await c.readLibrary();
        if ((a.machineSettings || a.resetMachine || a.jobFile) && !a.machine)
          throw Error("Select a machine");
        if (a.machine)
          library = {
            ...library,
            machines: {
              desktop:
                library.machines?.desktop ?? defaultMachineSettings("desktop"),
              pro: library.machines?.pro ?? defaultMachineSettings("pro"),
              [a.machine]: machineSettingsSchema.parse({
                ...((a.resetMachine
                  ? undefined
                  : library.machines?.[a.machine]) ??
                  defaultMachineSettings(a.machine)),
                ...a.machineSettings,
              }),
            },
          };
        library = {
          ...library,
          ...(a.displayUnits ? { displayUnits: a.displayUnits } : {}),
          ...(a.defaultMachine ? { defaultMachine: a.defaultMachine } : {}),
          ...(a.showFileLabels !== undefined
            ? { showFileLabels: a.showFileLabels }
            : {}),
          importSettings: importSettingsSchema.parse({
            ...((a.resetImport ? undefined : library.importSettings) ??
              defaultImportSettings()),
            ...a.importSettings,
          }),
        };
        const changed =
          Object.keys(a).some(
            (k) => !["resetMachine", "resetImport"].includes(k),
          ) ||
          a.resetMachine ||
          a.resetImport;
        if (changed) await c.writeLibrary(library);
        let job;
        if (a.jobFile) {
          job = changeJobMachine(await c.read(a.jobFile), a.machine!, library);
          job = await c.save(a.jobFile, {
            ...job,
            machineSettings: library.machines![a.machine!],
          });
        }
        const { materials, layouts, ...settings } = library;
        return response({ settings, ...(job ? { job } : {}) });
      }),
  );
  server.tool(
    "setting_default",
    "Save or resolve a default with the same global/material scoping as the right-click editor menu. Resolve returns a value to apply via edit_part/edit_contour/configure_job. Material-specific defaults require materialId.",
    {
      action: z.enum(["save", "resolve"]),
      key,
      value: value.optional(),
      fallback: value.optional(),
      materialId: key.optional(),
    },
    async (a) =>
      c.serial(async () => {
        const library = await c.readLibrary(),
          m = a.materialId
            ? library.materials.find((m) => m.id === a.materialId)
            : undefined;
        if (a.materialId && !m) throw Error("Unknown material ID");
        if (a.action === "resolve")
          return response({
            key: a.key,
            value: resolveSettingDefault(library, a.key, a.fallback ?? null, m),
          });
        if (a.value === undefined) throw Error("Save requires value");
        const next = saveSettingDefault(library, a.key, a.value, m);
        await c.writeLibrary(next);
        return response({
          key: a.key,
          value: resolveSettingDefault(next, a.key, a.value, m),
          scope: m?.id ?? "global",
        });
      }),
  );
  server.tool(
    "export_job_svg",
    "Return a part or sheet SVG with physical mm dimensions and optional toolpath/rapid overlay. Use post_sheet for machine G-code.",
    {
      file,
      sheetId: key.optional(),
      partId: key.optional(),
      toolpaths: z.boolean().default(false),
    },
    async (a) => {
      const job = await c.read(a.file);
      if (!!a.sheetId === !!a.partId)
        throw Error("Choose exactly one sheetId or partId");
      const project = a.sheetId
        ? sheetProject(job, a.sheetId)
        : viewProject(job, { kind: "part", id: a.partId! });
      let svg = svgExport(project);
      if (a.toolpaths) {
        const plan = planForPosting(project);
        svg = svg.replace(
          "</svg>",
          `<g fill="none" stroke-width="0.2">${plan.moves.map((m) => `<path stroke="${m.kind === "rapid" ? "#6c8793" : "#e38e3b"}" ${m.kind === "rapid" ? 'stroke-dasharray="1 1"' : ""} d="M${m.from.x},${m.from.y} L${m.to.x},${m.to.y}"/>`).join("")}</g></svg>`,
        );
      }
      return { content: [{ type: "text" as const, text: svg }] };
    },
  );
  server.tool(
    "simulate_sheet",
    "Simulate the exact posted G-code without writing files or operating hardware. Returns time, paged events and state at seconds or eventIndex (step). Same rapid-feed and valve interpreter as GUI playback.",
    {
      file,
      sheetId: key,
      rapidFeed: z.number().positive().max(1000000).default(3000),
      seconds: z.number().nonnegative().default(0),
      eventIndex: z.number().int().nonnegative().optional(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(0).max(2000).default(100),
    },
    async (a) => {
      const job = await c.read(a.file);
      sheet(job, a.sheetId);
      const posted = postJob(job, a.sheetId)[0],
        simulation = parseSimulation(posted.content, a.rapidFeed);
      if (a.eventIndex !== undefined && !simulation.events[a.eventIndex])
        throw Error("Simulation event index out of range");
      const t =
        a.eventIndex === undefined
          ? a.seconds
          : simulation.events[a.eventIndex].start;
      const { content, ...estimate } = posted;
      return response({
        sheetId: a.sheetId,
        seconds: simulation.seconds,
        totalEvents: simulation.events.length,
        at: simulationAt(simulation, t),
        events: simulation.events.slice(a.offset, a.offset + a.limit),
        nextOffset:
          a.limit > 0 && a.offset + a.limit < simulation.events.length
            ? a.offset + a.limit
            : null,
        estimate,
      });
    },
  );
  server.tool(
    "job_history",
    "Undo or redo saved-job mutations made by this MCP server session. Status reports availability. External file edits invalidate history; histories are not shared with GUI undo.",
    { file, action: z.enum(["undo", "redo", "status"]) },
    async (a) =>
      c.serial(async () => response(await c.history(a.file, a.action))),
  );
  server.tool(
    "import_parts",
    "Import STEP/STP planar faces, SVG/DXF or raster artwork through the same Chromium/font/tracing pipeline as the editor. Supply relative paths within WAM_PROJECT_DIR or inline text/base64. Linked assets must be beside path inputs. Batch successes are saved; errors are reported per file. Source files are unchanged. STEP auto-selects a broad planar face with openings; optional stepFaceId selects a body:face ID. Returned part stepSource lists alternatives; blind pockets require review.",
    {
      file,
      inputs: z
        .array(
          z.object({
            path: z.string().min(1).optional(),
            name: z.string().min(1).optional(),
            source: z.string().max(14000000).optional(),
            encoding: z.enum(["utf8", "base64"]).default("utf8"),
            stepFaceId: z.string().optional(),
            quantity: z.number().int().min(0).max(2000).default(1),
          }),
        )
        .min(1)
        .max(100),
      dxfUnits: z.enum(["mm", "in"]).default("mm"),
      settings: importSettingsSchema.partial().optional(),
    },
    async (a) =>
      c.serial(async () => {
        const job = await c.read(a.file),
          library = await c.readLibrary(),
          m = job.materials.find((m) => m.id === job.sheets[0].materialId)!;
        const settings = importSettingsSchema.parse({
            ...library.importSettings,
            ...a.settings,
          }),
          parts = [...job.parts],
          imported: unknown[] = [],
          errors: unknown[] = [];
        const root = await realpath(c.root);
        for (const input of a.inputs)
          try {
            if (!!input.path === (input.source !== undefined))
              throw Error("Provide exactly one path or source");
            let sourcePath: string | undefined, bytes: Buffer;
            if (input.path) {
              const candidate = path.resolve(root, input.path);
              const relative = path.relative(root, candidate);
              if (relative.startsWith("..") || path.isAbsolute(relative))
                throw Error("Import path must stay inside WAM_PROJECT_DIR");
              sourcePath = await realpath(candidate);
              const realRelative = path.relative(root, sourcePath);
              if (
                realRelative.startsWith("..") ||
                path.isAbsolute(realRelative)
              )
                throw Error("Import symlink escapes WAM_PROJECT_DIR");
              const info = await stat(sourcePath);
              if (!info.isFile() || info.size > 10000000)
                throw Error("Drawing exceeds 10 MB");
              bytes = await readFile(sourcePath);
            } else bytes = Buffer.from(input.source!, input.encoding);
            if (bytes.length > 10000000) throw Error("Drawing exceeds 10 MB");
            const name =
              input.name ??
              (sourcePath ? path.basename(sourcePath) : undefined);
            if (!name)
              throw Error("Inline input needs a filename including extension");
            const result = await importDrawing({
              name,
              data: bytes.toString("base64"),
              sourcePath,
              settings,
              unit: a.dxfUnits,
              stepFaceId: input.stepFaceId,
            });
            const p = partDefinitionSchema.parse({
              ...newPartDefaults(
                result.part,
                matchingDefaultMaterial(library, m) ?? m,
              ),
              materialId: m.id,
              quantity: input.quantity,
            });
            parts.push(p);
            imported.push({
              name,
              partId: p.id,
              contours: p.contours.length,
              notices: result.notices,
              stepFaces: p.stepSource?.faces.map(
                ({ id, label, area, holes }) => ({
                  id,
                  label,
                  areaMm2: area,
                  holes,
                }),
              ),
              selectedStepFace: p.stepSource?.selected,
            });
          } catch (error) {
            errors.push({
              name: input.name ?? input.path,
              error: (error as Error).message,
            });
          }
        const saved = imported.length
          ? await c.save(a.file, { ...job, parts })
          : job;
        return response({ job: saved, imported, errors });
      }),
  );
}

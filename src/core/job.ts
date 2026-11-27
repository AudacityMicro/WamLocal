import { automaticJobName, jobDate } from "./job-name";
import {
  deduplicateContours,
  classifyImportedContours,
} from "./import-contours";
import {
  machineSettingsSchema,
  type MachineSettings,
  defaultMachineSettings,
} from "./machine-settings";
import { z } from "zod";
import { canonicalStockName } from "./stock-name";
import { importSettingsSchema } from "./import-settings";
import { ORIGIN_ANCHORS } from "./work-origin";
import {
  id,
  newProject,
  partSchema,
  contourSchema,
  pointSchema,
  projectSchema,
  tabRulesSchema,
  savedDefaultsSchema,
  type Project,
} from "./model";
import { bounds, transformed, plan, nest } from "./geometry";

export const materialSettingsSchema = projectSchema.shape.material;
export const jobMaterialSchema = materialSettingsSchema.extend({
  id: z.string().min(1),
  machine: z.enum(["desktop", "pro"]),
  source: z.string().optional(),
  stockKey: z.string().min(1).optional(),
});
export function materialsCompatible(
  a: JobMaterial | undefined,
  b: JobMaterial | undefined,
) {
  return (
    !!a &&
    !!b &&
    canonicalStockName(
      a.stockKey ?? a.name.replace(/\s*[\u00b7-]\s*(coarse|medium|fine)$/i, ""),
    ) ===
      canonicalStockName(
        b.stockKey ??
          b.name.replace(/\s*[\u00b7-]\s*(coarse|medium|fine)$/i, ""),
      ) &&
    Math.abs(a.thickness - b.thickness) < 0.0001 &&
    a.machine === b.machine
  );
}
export const partDefinitionSchema = partSchema.extend({
  contours: z.array(contourSchema).max(1000),
  materialId: z.string().min(1),
  quantity: z.number().int().min(0).max(2000),
});
export const placementSchema = z.object({
  locked: z.boolean().optional(),
  id: z.string().min(1),
  partId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().finite(),
  scale: z.number().positive().max(1000),
});
export const sheetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  materialId: z.string().min(1),
  stock: projectSchema.shape.stock,
  wcs: pointSchema,
  workOrigin: z.enum(ORIGIN_ANCHORS).optional(),
  workOriginReference: z.enum(['sheet','parts']).optional(),
  placements: z.array(placementSchema).max(2000),
});
export const jobSchema = z
  .object({
    version: z.literal(2),
    name: z.string().min(1),
    nameMode: z.enum(["auto", "manual"]).optional(),
    nameDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    nameUnits: z.enum(["mm", "in"]).optional(),
    machine: z.enum(["desktop", "pro"]),
    machineSettings: machineSettingsSchema.optional(),
    nesting: projectSchema.shape.nesting,
    sharedSetup: z.boolean().optional(),
    tabRules: tabRulesSchema.optional(),
    materials: z.array(jobMaterialSchema).min(1).max(5000),
    parts: z.array(partDefinitionSchema).max(2000),
    sheets: z.array(sheetSchema).min(1).max(500),
  })
  .transform((job) => {
    job = {
      ...job,
      parts: job.parts.map((p) => {
        const unique = deduplicateContours(p.contours);
        return unique.length === p.contours.length
          ? p
          : { ...p, contours: classifyImportedContours(unique) };
      }),
    };
    const material = job.materials.find(
      (m) => m.id === job.sheets[0].materialId,
    );
    if (job.nameMode === "auto" && material) {
      const date = job.nameDate ?? jobDate();
      job = {
        ...job,
        nameDate: date,
        name: automaticJobName(material, date, job.nameUnits ?? "mm"),
      };
    }
    if (!job.sharedSetup) return job;
    const first = job.sheets[0];
    const base = job.materials.find((m) => m.id === first.materialId);
    if (!base) return job;
    return {
      ...job,
      parts: job.parts.map((p) => ({ ...p, materialId: base.id })),
      sheets: job.sheets.map((s) => ({
        ...s,
        materialId: base.id,
        stock: {
          ...s.stock,
          width: first.stock.width,
          height: first.stock.height,
          margin: first.stock.margin,
          spacing: first.stock.spacing,
        },
        workOrigin: first.workOrigin,
        workOriginReference: first.workOriginReference,
      })),
    };
  })
  .superRefine((job, ctx) => {
    for (const [name, list] of [
      ["material", job.materials],
      ["part", job.parts],
      ["sheet", job.sheets],
    ] as const)
      if (new Set(list.map((x) => x.id)).size !== list.length)
        ctx.addIssue({ code: "custom", message: `Duplicate ${name} IDs` });
    const materials = new Set(job.materials.map((m) => m.id)),
      parts = new Map(job.parts.map((p) => [p.id, p])),
      counts = new Map<string, number>(),
      ids = new Set<string>();
    for (const p of job.parts)
      if (!materials.has(p.materialId))
        ctx.addIssue({
          code: "custom",
          message: `Unknown material for ${p.name}`,
        });
    for (const s of job.sheets) {
      if (!materials.has(s.materialId))
        ctx.addIssue({
          code: "custom",
          message: `Unknown material for ${s.name}`,
        });
      for (const placement of s.placements) {
        if (ids.has(placement.id))
          ctx.addIssue({
            code: "custom",
            message: "Placement IDs must be unique across the job",
          });
        ids.add(placement.id);
        const p = parts.get(placement.partId);
        if (!p)
          ctx.addIssue({
            code: "custom",
            message: "Placement references an unknown part",
          });
        else if (
          !materialsCompatible(
            job.materials.find((m) => m.id === p.materialId),
            job.materials.find((m) => m.id === s.materialId),
          )
        )
          ctx.addIssue({
            code: "custom",
            message: `${p.name} material does not match ${s.name}`,
          });
        counts.set(placement.partId, (counts.get(placement.partId) ?? 0) + 1);
      }
    }
    for (const p of job.parts)
      if ((counts.get(p.id) ?? 0) > p.quantity)
        ctx.addIssue({
          code: "custom",
          message: `Placed copies exceed requested quantity for ${p.name}`,
        });
    if (ids.size > 20000)
      ctx.addIssue({
        code: "custom",
        message: "Job exceeds 20,000 placements",
      });
  });
export const materialLibrarySchema = z.object({
  version: z.literal(1),
  settingDefaults: savedDefaultsSchema.optional(),
  materials: z.array(jobMaterialSchema).max(20000),
  deletedMaterialIds: z.array(z.string().min(1)).max(20000).optional(),
  importSettings: importSettingsSchema.optional(),
  machines: z
    .object({ desktop: machineSettingsSchema, pro: machineSettingsSchema })
    .optional(),
  displayUnits: z.enum(["mm", "in"]).optional(),
  defaultMachine: z.enum(["desktop", "pro"]).optional(),
  showFileLabels: z.boolean().optional(),
  layouts: z
    .array(z.object({ id: z.string(), name: z.string(), job: jobSchema }))
    .max(100)
    .optional(),
});
export type Job = z.infer<typeof jobSchema>;
export type JobMaterial = z.infer<typeof jobMaterialSchema>;
export type PartDefinition = z.infer<typeof partDefinitionSchema>;
export type Sheet = z.infer<typeof sheetSchema>;
export type MaterialLibrary = z.infer<typeof materialLibrarySchema>;
export type JobView = { kind: "sheet" | "part"; id: string };
export const BED = { width: 460, height: 305 };
export function defaultMaterial(machine: Job["machine"]): JobMaterial {
  return {
    ...newProject().material,
    kerf: defaultMachineSettings(machine).kerf,
    abrasive: defaultMachineSettings(machine).abrasive,
    id: id(),
    machine,
    name: "Custom material",
    pierceDiameter: 0,
    source: "User defaults",
  };
}
export function newJob(
  machine: Job["machine"] = "desktop",
  settings?: MachineSettings,
): Job {
  const material = defaultMaterial(machine);
  return {
    version: 2,
    name: "Untitled job",
    machine,
    machineSettings: settings,
    sharedSetup: true,
    tabRules: {
      width: material.tabWidth,
      count: material.tabCount,
      automaticWidth: true,
      minHoleArea: 0,
    },
    materials: [material],
    parts: [],
    sheets: [
      {
        id: id(),
        name: "Sheet 1",
        materialId: material.id,
        stock: { ...newProject().stock },
        wcs: { x: 0, y: 0 },
        placements: [],
      },
    ],
  };
}
export function readJob(value: unknown): Job {
  if ((value as any)?.version !== 1) return jobSchema.parse(value);
  const old = projectSchema.parse(value),
    material: JobMaterial = {
      ...old.material,
      id: "material-legacy",
      machine: old.machine,
      pierceDiameter: old.material.pierceDiameter ?? 0,
      source: "Migrated job material",
    };
  return jobSchema.parse({
    version: 2,
    name: old.name,
    machine: old.machine,
    materials: [material],
    parts: old.parts.map((p) => ({
      ...p,
      x: 0,
      y: 0,
      materialId: material.id,
      quantity: 1,
    })),
    sheets: [
      {
        id: "sheet-legacy",
        name: "Sheet 1",
        materialId: material.id,
        stock: old.stock,
        wcs: { x: 0, y: 0 },
        placements: old.parts.map((p) => {
          const b = bounds(transformed(p).flatMap((c) => c.points));
          return {
            id: p.id,
            partId: p.id,
            x: b.x,
            y: b.y,
            rotation: 0,
            scale: 1,
          };
        }),
      },
    ],
  });
}
export function definitionContours(part: PartDefinition) {
  if (!part.contours.length) return [];
  const contours = transformed(part),
    b = bounds(contours.flatMap((c) => c.points));
  return contours.map((c) => ({
    ...c,
    points: c.points.map((p) => ({ x: p.x - b.x, y: p.y - b.y })),
  }));
}
export function sheetProject(job: Job, sheetId: string): Project {
  const sheet = job.sheets.find((s) => s.id === sheetId);
  if (!sheet) throw Error("Unknown sheet");
  const material = job.materials.find((m) => m.id === sheet.materialId)!;
  return projectSchema.parse({
    version: 1,
    name: job.name,
    machine: job.machine,
    machineSettings: job.machineSettings,
    nesting: job.nesting,
    tabRules: job.tabRules,
    stock: sheet.stock,
    bedOffset: sheet.wcs,
    material: machineProcess(job, material),
    parts: sheet.placements.flatMap((i) => {
      const p = job.parts.find((p) => p.id === i.partId)!;
      if (!p.contours.length) return [];
      return [
        {
          ...p,
          locked: i.locked,
          id: i.id,
          definitionId: p.id,
          process: machineProcess(
            job,
            p.process ?? job.materials.find((m) => m.id === p.materialId)!,
          ),
          contours: definitionContours(p),
          x: i.x,
          y: i.y,
          rotation: i.rotation,
          scale: i.scale,
        },
      ];
    }),
  });
}
export function viewProject(job: Job, view: JobView): Project {
  if (view.kind === "sheet") return sheetProject(job, view.id);
  const part = job.parts.find((p) => p.id === view.id);
  if (!part) throw Error("Unknown part");
  return projectSchema.parse({
    version: 1,
    name: job.name,
    machine: job.machine,
    machineSettings: job.machineSettings,
    tabRules: job.tabRules,
    stock: { ...newProject().stock },
    material: machineProcess(
      job,
      job.materials.find((m) => m.id === part.materialId)!,
    ),
    parts: part.contours.length
      ? [
          {
            ...part,
            process: machineProcess(
              job,
              part.process ??
                job.materials.find((m) => m.id === part.materialId)!,
            ),
          },
        ]
      : [],
  });
}
export function placedCount(job: Job, partId: string) {
  return job.sheets.reduce(
    (sum, s) => sum + s.placements.filter((p) => p.partId === partId).length,
    0,
  );
}

function machineProcess(job: Job, material: Project["material"]) {
  return job.machineSettings
    ? {
        ...material,
        kerf: job.machineSettings.kerf,
        abrasive: job.machineSettings.abrasive,
      }
    : material;
}

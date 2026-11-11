import { z } from "zod";
import {
  id,
  newProject,
  partSchema,
  contourSchema,
  pointSchema,
  projectSchema,
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
    (a.stockKey ?? a.name) === (b.stockKey ?? b.name) &&
    Math.abs(a.thickness - b.thickness) < 1e-7 &&
    a.machine === b.machine
  );
}
export const partDefinitionSchema = partSchema.extend({
  contours: z.array(contourSchema).max(1000),
  materialId: z.string().min(1),
  quantity: z.number().int().min(1).max(2000),
});
export const placementSchema = z.object({
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
  placements: z.array(placementSchema).max(2000),
});
export const jobSchema = z
  .object({
    version: z.literal(2),
    name: z.string().min(1),
    machine: z.enum(["desktop", "pro"]),
    materials: z.array(jobMaterialSchema).min(1).max(5000),
    parts: z.array(partDefinitionSchema).max(2000),
    sheets: z.array(sheetSchema).min(1).max(500),
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
  materials: z.array(jobMaterialSchema).max(5000),
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
    id: id(),
    machine,
    name: "Custom material",
    pierceDiameter: 0,
    source: "User defaults",
  };
}
export function newJob(machine: Job["machine"] = "desktop"): Job {
  const material = defaultMaterial(machine);
  return {
    version: 2,
    name: "Untitled job",
    machine,
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
    stock: sheet.stock,
    material,
    parts: sheet.placements.flatMap((i) => {
      const p = job.parts.find((p) => p.id === i.partId)!;
      if (!p.contours.length) return [];
      return [
        {
          ...p,
          id: i.id,
          definitionId: p.id,
          process: job.materials.find((m) => m.id === p.materialId),
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
    stock: { ...newProject().stock },
    material: job.materials.find((m) => m.id === part.materialId),
    parts: part.contours.length
      ? [
          {
            ...part,
            process: job.materials.find((m) => m.id === part.materialId),
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

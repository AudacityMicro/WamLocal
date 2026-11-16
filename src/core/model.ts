import { machineSettingsSchema } from "./machine-settings";
import { z } from "zod";
export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export const contourSchema = z.object({
  points: z.array(pointSchema).min(2).max(20000),
  closed: z.boolean(),
  hole: z.boolean().default(false),
  cut: z.enum(["outside", "inside", "centerline"]).optional(),
  tabMode: z.enum(["auto", "manual", "none"]).optional(),
  tabs: z
    .array(
      z.object({
        position: z.number().min(0).max(1),
        width: z.number().positive().max(20),
      }),
    )
    .max(100)
    .optional(),
  lead: z.number().nonnegative().max(30).optional(),
  startPosition: z.number().min(0).max(1).optional(),
});
export const materialSchema = z.object({
  quality: z.enum(["coarse", "medium", "fine", "custom"]).optional(),
  requiresVerification: z.boolean().optional(),
  name: z.string(),
  thickness: z.number().positive(),
  feed: z.number().positive(),
  abrasive: z.number().nonnegative().optional(),
  preset: z
    .object({ id: z.string(), quality: z.enum(["coarse", "medium", "fine"]) })
    .optional(),
  pierce: z.number().nonnegative(),
  pierceDiameter: z.number().nonnegative().max(100).optional(),
  kerf: z.number().nonnegative().max(10),
  tabWidth: z.number().nonnegative().max(20),
  tabCount: z.number().int().min(0).max(20),
  lead: z.number().nonnegative().max(30),
});
export const partSchema = z.object({
  locked: z.boolean().optional(),
  rotationPolicy: z.enum(["free", "fixed", "grain-x", "grain-y"]).optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  contours: z.array(contourSchema).min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().finite(),
  scale: z.number().positive().max(1000),
  cut: z.enum(["outside", "inside", "centerline"]),
  definitionId: z.string().optional(),
  stockToLeave: z.number().min(-10).max(10).optional(),
  process: materialSchema.optional(),
});
export const nestingSchema = z.object({
  rotationStep: z.number().int().min(1).max(90).default(90),
  budgetSeconds: z.number().min(1).max(900).default(30),
  budgetMode: z.enum(["auto", "fixed"]).optional(),
  allowRotation: z.boolean().optional(),
  maxAutoSeconds: z.number().min(5).max(900).optional(),
  effort: z.enum(["fast", "balanced", "thorough"]).optional(),
  method: z.enum(["auto", "outline", "bounds"]).optional(),
  order: z.enum(["area", "longest", "perimeter", "input"]).optional(),
  objective: z.enum(["compact", "height", "width"]).optional(),
  detail: z.enum(["coarse", "normal", "fine"]).optional(),
  restarts: z.number().int().min(1).max(64).optional(),
  stallPasses: z.number().int().min(1).max(10).optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
  allowNewSheets: z.boolean().optional(),
  maxSheets: z.number().int().min(1).max(500).optional(),
  preservePlaced: z.boolean().optional(),
  insideHoles: z.boolean().default(false),
  optimize: z.boolean().default(false),
});
export const projectSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    machine: z.enum(["desktop", "pro"]),
    machineSettings: machineSettingsSchema.optional(),
    bedOffset: pointSchema.optional(),
    nesting: nestingSchema.optional(),
    stock: z.object({
      width: z.number().positive().max(460),
      height: z.number().positive().max(305),
      margin: z.number().nonnegative().max(100),
      spacing: z.number().nonnegative().max(100),
      outline: z.array(pointSchema).min(3).max(20000).optional(),
      exclusions: z.array(z.array(pointSchema).min(3).max(20000)).optional(),
    }),
    material: materialSchema,
    parts: z.array(partSchema).max(2000),
  })
  .superRefine((p, ctx) => {
    if (new Set(p.parts.map((x) => x.id)).size !== p.parts.length)
      ctx.addIssue({ code: "custom", message: "Part IDs must be unique" });
  });
export type Point = z.infer<typeof pointSchema>;
export type Contour = z.infer<typeof contourSchema>;
export type Part = z.infer<typeof partSchema>;
export type Project = z.infer<typeof projectSchema>;
export const newProject = (): Project => ({
  version: 1,
  name: "Untitled cut job",
  machine: "desktop",
  stock: { width: 460, height: 305, margin: 8, spacing: 4 },
  material: {
    name: "Custom material · example parameters",
    thickness: 3,
    feed: 100,
    pierce: 5,
    kerf: 1.1,
    tabWidth: 2,
    tabCount: 2,
    lead: 2,
  },
  parts: [],
});
export const id = () => crypto.randomUUID();
export function rectangle(w = 70, h = 45): Contour {
  return {
    closed: true,
    hole: false,
    points: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
  };
}
export function circle(r = 20): Contour {
  return {
    closed: true,
    hole: false,
    points: Array.from({ length: 96 }, (_, i) => ({
      x: r + r * Math.cos((i * Math.PI) / 48),
      y: r + r * Math.sin((i * Math.PI) / 48),
    })),
  };
}
export function makePart(
  name: string,
  contours: Contour[],
  x = 15,
  y = 15,
): Part {
  return {
    id: id(),
    name,
    contours,
    x,
    y,
    rotation: 0,
    scale: 1,
    cut: "outside",
  };
}

/** Zero is the legacy unset value. Resolve at use time so edits to kerf propagate. */
export function effectivePierceDiameter(
  process: Pick<Project["material"], "pierceDiameter" | "kerf">,
): number {
  return process.pierceDiameter && process.pierceDiameter > 0
    ? process.pierceDiameter
    : process.kerf;
}

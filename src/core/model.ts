import { machineSettingsSchema } from "./machine-settings";
import { z } from "zod";
import { defaultTabWidth } from "./tab-defaults";
import { MATERIAL_FAMILIES } from "./material-hierarchy";
export const tabRulesSchema = z.object({
  width: z.number().nonnegative().max(20),
  count: z.number().int().min(0).max(20),
  automaticWidth: z.boolean().default(true),
  minHoleArea: z.number().nonnegative().max(1e10).default(0),
  maxPartArea: z.number().positive().max(1e10).optional(),
});
export const savedDefaultsSchema = z.record(
  z.string(),
  z.union([z.number().finite(), z.string(), z.boolean(), z.null()]),
);
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
  leadInOverlap: z.number().nonnegative().max(30).optional(),
  leadOutOverlap: z.number().nonnegative().max(30).optional(),
  startPosition: z.number().min(0).max(1).optional(),
});
export const materialSchema = z.object({
  processRevision: z.number().int().nonnegative().optional(),
  family: z.enum(MATERIAL_FAMILIES).optional(),
  materialClass: z.string().max(120).optional(),
  grade: z.string().max(120).optional(),
  organizationRevision: z.number().nonnegative().optional(),
  settingDefaults: savedDefaultsSchema.optional(),
  source: z.string().optional(),
  leadStyle: z.enum(["arc", "straight"]).optional(),
  cornerSlowdown: z.boolean().optional(),
  quality: z.enum(["coarse", "medium", "fine", "custom"]).optional(),
  // Legacy process provenance for preset selection/upgrades; never a posting gate.
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
  tabDefaultWidthMm: z.number().nonnegative().optional(),
  tabCount: z.number().int().min(0).max(20),
  lead: z.number().nonnegative().max(30),
  leadInOverlap: z.number().nonnegative().max(30).optional(),
  leadOutOverlap: z.number().nonnegative().max(30).optional(),
});
export const partSchema = z.object({
  stepSource: z
    .object({
      selected: z.string(),
      toleranceMm: z.number().positive(),
      bodyCount: z.number().int().positive(),
      faces: z
        .array(
          z.object({
            id: z.string(),
            body: z.string(),
            label: z.string(),
            area: z.number().positive(),
            holes: z.number().int().nonnegative(),
            blindHoles: z.number().int().nonnegative(),
            normal: z.tuple([
              z.number().finite(),
              z.number().finite(),
              z.number().finite(),
            ]),
            contours: z.array(contourSchema).min(1).max(1000),
          }),
        )
        .min(1)
        .max(5000),
    })
    .optional(),
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
    tabRules: tabRulesSchema.optional(),
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
    tabWidth: defaultTabWidth(3),
    tabDefaultWidthMm: defaultTabWidth(3),
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

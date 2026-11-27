import {z} from 'zod';
export const DEFAULT_IMPORT_TOLERANCE_MM=0.01;
export const importSettingsSchema=z.object({
  curveToleranceMm:z.number().finite().min(0.0001).max(5).default(DEFAULT_IMPORT_TOLERANCE_MM),
  traceDpi:z.number().int().min(72).max(2400).default(600),
  traceThreshold:z.number().int().min(1).max(254).default(128),
});
export type ImportSettings=z.infer<typeof importSettingsSchema>;
export const defaultImportSettings=()=>importSettingsSchema.parse({});
export function importTolerance(value=DEFAULT_IMPORT_TOLERANCE_MM){
  return importSettingsSchema.shape.curveToleranceMm.parse(value);
}

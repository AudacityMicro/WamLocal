import { z } from "zod";
export const machineSettingsSchema = z.object({
  kerf: z.number().positive().max(10),
  abrasive: z.number().nonnegative().max(10000),
  width: z.number().positive().max(460),
  height: z.number().positive().max(305),
});
export type MachineSettings = z.infer<typeof machineSettingsSchema>;
export const WAM_CAPTURED_KERF_MM = 0.038 * 25.4;
export function defaultMachineSettings(
  machine: "desktop" | "pro",
): MachineSettings {
  return {
    kerf: machine === "pro" ? WAM_CAPTURED_KERF_MM : 1.1,
    abrasive: 150,
    width: 460,
    height: 305,
  };
}

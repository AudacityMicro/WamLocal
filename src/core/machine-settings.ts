import { z } from "zod";
export const machineSettingsSchema = z.object({
  abrasiveCostPerKg: z.number().nonnegative().max(100000).optional(),
  runningCostPerHour: z.number().nonnegative().max(100000).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  kerf: z.number().positive().max(10),
  abrasive: z.number().nonnegative().max(10000),
  width: z.number().positive().max(460),
  height: z.number().positive().max(305),
});
export type MachineSettings = z.infer<typeof machineSettingsSchema>;
export const WAM_CAPTURED_KERF_MM = 0.038 * 25.4;
export function withDefaultMachineCosts(machine:"desktop"|"pro", settings?:MachineSettings):MachineSettings {
  const defaults=defaultMachineSettings(machine), current=settings??defaults;
  return {...current,abrasiveCostPerKg:current.abrasiveCostPerKg??defaults.abrasiveCostPerKg,runningCostPerHour:current.runningCostPerHour??defaults.runningCostPerHour,currency:current.currency??defaults.currency};
}
export function defaultMachineSettings(
  machine: "desktop" | "pro",
): MachineSettings {
  return {
    kerf: WAM_CAPTURED_KERF_MM,
    abrasive: 150,
    width: 460,
    height: 305,
    abrasiveCostPerKg: 0.53 / 0.45359237,
    runningCostPerHour: machine === "pro" ? 6.64 : 5.22,
    currency: "USD",
  };
}

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readJob, materialLibrarySchema } from "./job";
import { postJob } from "./postprocessor";
import { inspectReferenceNc } from "./nc-inspect";
import { initialMaterialLibrary } from "./material-library";
import { writeLibraryFile, readLibraryFile } from "../desktop/material-library";
import { mkdtemp } from "node:fs/promises";
import { changeJobMachine } from "./job-ops";
import { newJob } from "./job";
import { tmpdir } from "node:os";
import path from "node:path";

describe("posted time, abrasive and cost estimates", () => {
  it("retargets a job with same-stock/quality profiles and never carries Pro rates into Desktop", () => {
    const library = initialMaterialLibrary(),
      job = newJob("desktop");
    job.materials[0] = {
      ...job.materials[0],
      name: "Aluminum 6061",
      stockKey: "Aluminum 6061",
      thickness: 0.508,
      quality: "medium",
      requiresVerification: true,
    };
    const pro = changeJobMachine(job, "pro", library);
    expect(pro.materials[0].id).toBe(job.materials[0].id);
    expect(pro.materials[0].feed).toBeCloseTo(537.78, 8);
    expect(pro.materials[0].pierce).toBe(1.21);
    expect(pro.materials[0].requiresVerification).toBe(false);
    const desktop = changeJobMachine(pro, "desktop", library);
    expect(desktop.materials[0].feed).toBe(186.59);
    expect(desktop.materials[0].requiresVerification).toBe(true);
    expect(job.machine).toBe("desktop");
    expect(job.materials[0].requiresVerification).toBe(true);
  });
  it("accounts for emitted feeds, valve dwells, pierces and both cost components", () => {
    const job = readJob(
      JSON.parse(
        readFileSync(
          new URL("../../fixtures/posting/two-sheets.wam", import.meta.url),
          "utf8",
        ),
      ),
    );
    job.machineSettings = {
      kerf: 0.8,
      abrasive: 150,
      width: 460,
      height: 305,
      abrasiveCostPerKg: 2,
      runningCostPerHour: 6,
      currency: "USD",
    };
    job.tabRules = {
      width: 1.016,
      count: 2,
      automaticWidth: false,
      minHoleArea: 0,
    };
    for (const f of postJob(job)) {
      const nc = inspectReferenceNc(f.content);
      expect(f.cutSeconds).toBeCloseTo(nc.linearSeconds, 1);
      expect(f.pierceSeconds + f.overheadSeconds).toBeCloseTo(
        nc.dwellSeconds,
        5,
      );
      expect(f.seconds).toBe(
        Math.ceil(f.cutSeconds + f.pierceSeconds + f.overheadSeconds),
      );
      expect(f.abrasiveGrams).toBeCloseTo(
        ((f.cutSeconds + f.pierceSeconds + f.operations) * 150) / 60,
        5,
      );
      expect(f.cost.abrasive).toBeCloseTo((f.abrasiveGrams / 1000) * 2, 8);
      expect(f.cost.running).toBeCloseTo(
        ((f.cutSeconds + f.pierceSeconds + f.overheadSeconds) / 3600) * 6,
        8,
      );
      expect(f.cost.total).toBeCloseTo(f.cost.abrasive! + f.cost.running!, 8);
    }
    delete job.machineSettings.abrasiveCostPerKg;
    expect(postJob(job)[0].cost.total).toBeNull();
    job.machineSettings.abrasiveCostPerKg = 0;
    job.machineSettings.runningCostPerHour = 0;
    expect(postJob(job)[0].cost.total).toBe(0);
  });
  it("persists the preferred machine and its costs through the real library file", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "wam-preference-"));
    const file = path.join(folder, "library.json");
    const library = initialMaterialLibrary();
    library.defaultMachine = "pro";
    library.machines!.pro = {
      ...library.machines!.pro,
      abrasiveCostPerKg: 1.17,
      runningCostPerHour: 5.22,
    };
    await writeLibraryFile(file, library);
    const read = materialLibrarySchema.parse(await readLibraryFile(file));
    expect(read.defaultMachine).toBe("pro");
    expect(read.machines!.pro.runningCostPerHour).toBe(5.22);
  });
});

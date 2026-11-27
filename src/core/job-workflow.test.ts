import { describe, it, expect } from "vitest";
import { newJob, jobSchema } from "./job";
import {
  initialMaterialLibrary,
  extendMaterialLibrary,
} from "./material-library";
import { applyNewJobDefaults } from "./setting-defaults";
import { setJobMaterial } from "./job-ops";
import { materialName } from "./material-selection";
import { saveJobMaterialProfiles } from "./job-material-actions";
import { jobDate } from "./job-name";
describe("job material and naming workflow", () => {
  const library = initialMaterialLibrary();
  it.each(["desktop", "pro"] as const)(
    "defaults %s jobs to same-machine 6061, 3 mm and medium quality",
    (machine) => {
      const job = applyNewJobDefaults(newJob(machine), library),
        m = job.materials[0];
      expect(materialName(m)).toBe("Aluminum - 6061");
      expect(m.machine).toBe(machine);
      expect(m.quality).toBe("medium");
      expect(m.thickness).toBeCloseTo(3, 4);
      expect(job.name).toContain(`${jobDate()} · Aluminum 6061 · 3 mm`);
      expect(job.nameMode).toBe("auto");
      const brass = library.materials.find(
        (p) => p.machine === machine && materialName(p) === "Brass - 260",
      )!;
      const changed = setJobMaterial(job, brass);
      expect(changed.name).toContain("Brass 260");
      expect(changed.nameDate).toBe(job.nameDate);
      const manual = setJobMaterial(
        { ...job, name: "Customer fixture", nameMode: "manual" },
        brass,
      );
      expect(manual.name).toBe("Customer fixture");
      expect(jobSchema.parse({ ...changed, nameUnits: "in" }).name).toMatch(
        / in$/,
      );
      expect(
        jobSchema.parse({ ...newJob(machine), name: "Old saved name" }).name,
      ).toBe("Old saved name");
    },
  );
  it("creates three profiles without inventing other-machine or gauge settings on reload", () => {
    const job = applyNewJobDefaults(newJob(), library),
      current = job.materials[0];
    const profiles = (["coarse", "medium", "fine"] as const).map(
      (quality, i) => ({
        ...current,
        id: `user-${quality}`,
        name: `Aluminum - 6063 · ${quality}`,
        stockKey: "Aluminum - 6063",
        quality,
        feed: 100 - i * 10,
        settingDefaults: undefined,
      }),
    );
    const result = saveJobMaterialProfiles(
      library,
      job,
      profiles,
      "user-medium",
    );
    expect(
      materialName(
        result.job.materials.find(
          (m) => m.id === result.job.sheets[0].materialId,
        )!,
      ),
    ).toBe("Aluminum - 6063");
    expect(
      extendMaterialLibrary(result.library)
        .materials.filter((m) => materialName(m) === "Aluminum - 6063")
        .map((m) => m.machine),
    ).toEqual(["desktop", "desktop", "desktop"]);
    expect(job.materials[0]).toEqual(current);
  });
  it("preserves this job's tab rule overrides when only material process values change",()=>{
    const job=applyNewJobDefaults(newJob(),library),current=job.materials[0];
    job.tabRules={width:.8,count:5,automaticWidth:false,minHoleArea:33};
    const edited=saveJobMaterialProfiles(library,job,[{...current,feed:333,settingDefaults:{"tabs.width":.4}}],current.id);
    expect(edited.job.tabRules).toEqual(job.tabRules);
  });
  it("edits a shared preset and current job, preserving other job snapshots and synchronizing saved defaults", () => {
    const job = applyNewJobDefaults(newJob(), library),
      current = job.materials[0],
      before = structuredClone(job);
    const result = saveJobMaterialProfiles(
      library,
      job,
      [
        {
          ...current,
          feed: 333,
          tabWidth: 0.7,
          tabCount: 3,
          settingDefaults: { "process.feed": 100, "tabs.width": 0.4 },
        },
      ],
      current.id,
    );
    expect(
      result.library.materials.find((m) => m.id === current.id)!.feed,
    ).toBe(333);
    expect(
      result.library.materials.find((m) => m.id === current.id)!
        .settingDefaults!["process.feed"],
    ).toBe(333);
    expect(result.job.tabRules).toMatchObject({
      width: 0.7,
      count: 3,
      automaticWidth: false,
    });
    expect(job).toEqual(before);
    expect(
      applyNewJobDefaults(newJob(), result.library).materials[0].feed,
    ).toBe(333);
    expect(() =>
      saveJobMaterialProfiles(
        library,
        job,
        [{ ...current, machine: "pro" }],
        current.id,
      ),
    ).toThrow(/machine/i);
  });
});

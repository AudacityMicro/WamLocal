import { id, type Part, type Project } from "./model";
import { defaultTabWidth } from "./tab-defaults";
import {materialTabDefaults,newContourDefaults,newPartDefaults} from "./setting-defaults";
import { bounds, transformed, plan } from "./geometry";
import { materialForMachine } from "./material-gauges";
import { defaultMachineSettings } from "./machine-settings";
import { materialName, materialQuality, thicknessKey } from "./material-selection";
import {
  BED,
  jobSchema,
  placedCount,
  materialsCompatible,
  sheetProject,
  type Job,
  type JobView,
  type MaterialLibrary,
  type JobMaterial,
} from "./job";

/** Apply a preset snapshot to the active part/sheet, retaining compatible placements. */
export function applyJobMaterial(job: Job, view: JobView, preset: JobMaterial): Job {
  if (job.sharedSetup) return setJobMaterial(job, preset);
  const record = materialForMachine(preset, job.machine);
  const next = structuredClone(job);
  next.materials = [...next.materials.filter(m => m.id !== record.id), record];
  if (view.kind === "part") return setPartMaterial(next, view.id, record.id);
  next.sheets = next.sheets.map(sheet => sheet.id !== view.id ? sheet : {
    ...sheet,
    materialId: record.id,
    placements: sheet.placements.filter(placement => {
      const part = next.parts.find(p => p.id === placement.partId);
      return materialsCompatible(next.materials.find(m => m.id === part?.materialId), record);
    }),
  });
  return jobSchema.parse(next);
}

export function changeJobMachine(job: Job, machine: Job["machine"], library: MaterialLibrary): Job {
  if (machine === job.machine) return job;
  const materials = job.materials.map(current => {
    if(current.machine===machine) return current;
    const matches=library.materials.filter(m=>m.machine===machine && materialName(m)===materialName(current) && thicknessKey(m.thickness)===thicknessKey(current.thickness) && materialQuality(m)===materialQuality(current));
    matches.sort((a,b)=>Number(!!a.requiresVerification)-Number(!!b.requiresVerification) || Number(!!b.source?.includes("demo feed capture"))-Number(!!a.source?.includes("demo feed capture")));
    return {...(matches[0]??materialForMachine(current,machine)),id:current.id,tabCount:current.tabCount,leadStyle:current.leadStyle,cornerSlowdown:current.cornerSlowdown};
  });
  return jobSchema.parse({...job,machine,materials,machineSettings:library.machines?.[machine] ?? defaultMachineSettings(machine)});
}

export function newDefinition(job: Job, materialId: string) {
  const partId = id();
  const defaults=job.materials.find(m=>m.id===materialId)?.settingDefaults ?? {};
  return {
    partId,
    job: jobSchema.parse({
      ...job,
      parts: [
        ...job.parts,
        {
          id: partId,
          name: `Part ${job.parts.length + 1}`,
          contours: [],
          x: 15,
          y: 15,
          rotation: 0,
          scale: 1,
          cut: defaults.cut ?? "outside",
          stockToLeave: defaults.stockToLeave ?? 0,
          materialId,
          quantity: 1,
        },
      ],
    }),
  };
}
export function placeDefinition(
  job: Job,
  partId: string,
  sheetId: string,
): Job {
  const p = job.parts.find((p) => p.id === partId),
    s = job.sheets.find((s) => s.id === sheetId);
  if (!p || !s) throw Error("Unknown part or sheet");
  if (!p.contours.length)
    throw Error("Draw or import geometry for this part first");
  if (
    !materialsCompatible(
      job.materials.find((m) => m.id === p.materialId),
      job.materials.find((m) => m.id === s.materialId),
    )
  )
    throw Error(
      "Part and sheet must use the same material preset and thickness",
    );
  if (placedCount(job, p.id) >= p.quantity)
    throw Error("All requested copies are placed. Increase quantity first.");
  return jobSchema.parse({
    ...job,
    sheets: job.sheets.map((sheet) =>
      sheet.id === s.id
        ? {
            ...sheet,
            placements: [
              ...sheet.placements,
              {
                id: id(),
                partId: p.id,
                x: s.stock.margin + 2,
                y: s.stock.margin + 2,
                rotation: 0,
                scale: 1,
              },
            ],
          }
        : sheet,
    ),
  });
}
export function setPartQuantity(
  job: Job,
  partId: string,
  quantity: number,
): Job {
  let kept = 0;
  return jobSchema.parse({
    ...job,
    parts: job.parts.map((p) => (p.id === partId ? { ...p, quantity } : p)),
    sheets: job.sheets.map((s) => ({
      ...s,
      placements: s.placements.filter(
        (p) => p.partId !== partId || ++kept <= quantity,
      ),
    })),
  });
}
export function setPartMaterial(
  job: Job,
  partId: string,
  materialId: string,
): Job {
  if (job.sharedSetup) {
    const material = job.materials.find(m => m.id === materialId);
    if (!material) throw Error("Unknown material");
    return setJobMaterial(job, material);
  }
  return jobSchema.parse({
    ...job,
    parts: job.parts.map((p) => (p.id === partId ? { ...p, materialId } : p)),
    sheets: job.sheets.map((s) => ({
      ...s,
      placements: s.placements.filter(
        (i) =>
          i.partId !== partId ||
          materialsCompatible(
            job.materials.find((m) => m.id === materialId),
            job.materials.find((m) => m.id === s.materialId),
          ),
      ),
    })),
  });
}

/** One material and one stock template for every part and sheet in this job. */
export function setJobMaterial(job: Job, preset: JobMaterial): Job {
  const material = materialForMachine(preset, job.machine);
  const old = job.materials.find(m=>m.id===job.sheets[0].materialId);
  const useSavedTabs = Object.keys(material.settingDefaults??{}).some(k=>k.startsWith("tabs.")) || (old && old.id !== material.id && !materialsCompatible(old,material));
  return jobSchema.parse({
    ...job, sharedSetup: true,
    materials: [...job.materials.filter(m => m.id !== material.id), material],
    parts: job.parts.map(p => ({ ...p, materialId: material.id })),
    sheets: job.sheets.map(s => ({ ...s, materialId: material.id })),
    tabRules: useSavedTabs ? materialTabDefaults(material) : job.tabRules && {
      ...job.tabRules,
      width: job.tabRules.automaticWidth ? defaultTabWidth(material.thickness) : job.tabRules.width,
    },
  });
}
export function editView(job: Job, view: JobView, next: Project): Job {
  const updated = structuredClone(job);
  updated.name = next.name;
  updated.machine = next.machine;
  updated.nesting = next.nesting;
  const materialId =
    view.kind === "sheet"
      ? updated.sheets.find((s) => s.id === view.id)!.materialId
      : updated.parts.find((p) => p.id === view.id)!.materialId;
  updated.materials = updated.materials.map((m) =>
    m.id === materialId
      ? {
          ...m,
          ...next.material,
          id: m.id,
          machine: m.machine,
          source: m.source,
        }
      : m,
  );
  if (view.kind === "part") {
    updated.parts = updated.parts.map((def) => {
      if (def.id !== view.id) return def;
      const own = next.parts.find((p) => p.id === def.id),
        extras = next.parts.filter((p) => p.id !== def.id);
      if (!next.parts.length) return { ...def, contours: [] };
      if (!extras.length && own)
        return { ...def, ...own, contours:own.contours.map((c,i)=>i<def.contours.length?c:newContourDefaults(c,updated.materials.find(m=>m.id===def.materialId)!)), definitionId: undefined };
      return {
        ...def,
        x: 0,
        y: 0,
        rotation: 0,
        scale: 1,
        contours: next.parts.flatMap(transformed),
      };
    });
  } else {
    const sheet = updated.sheets.find((s) => s.id === view.id)!;
    sheet.stock = next.stock;
    if (updated.sharedSetup) for (const s of updated.sheets) s.stock = {...s.stock, width: next.stock.width, height: next.stock.height, margin: next.stock.margin, spacing: next.stock.spacing};
    const before = new Map(sheet.placements.map((i) => [i.id, i]));
    sheet.placements = [];
    for (const p of next.parts) {
      const old = before.get(p.id);
      if (old) {
        sheet.placements.push({
          ...old,
          locked: p.locked,
          x: p.x,
          y: p.y,
          rotation: p.rotation,
          scale: p.scale,
        });
        const source = job.parts.find((d) => d.id === old.partId)!;
        updated.parts = updated.parts.map((d) =>
          d.id === old.partId
            ? {
                ...d,
                ...(p.name !== source.name ? { name: p.name } : {}),
                ...(p.cut !== source.cut ? { cut: p.cut } : {}),
              }
            : d,
        );
      } else {
        let def = updated.parts.find(
          (d) =>
            d.id === p.definitionId &&
            materialsCompatible(
              updated.materials.find((m) => m.id === d.materialId),
              updated.materials.find((m) => m.id === sheet.materialId),
            ),
        );
        let shift = { x: 0, y: 0 };
        if (!def) {
          const b = bounds(p.contours.flatMap((c) => c.points));
          const angle = (p.rotation * Math.PI) / 180;
          shift = {
            x: p.scale * (b.x * Math.cos(angle) - b.y * Math.sin(angle)),
            y: p.scale * (b.x * Math.sin(angle) + b.y * Math.cos(angle)),
          };
          def = {
            ...p,
            id: id(),
            definitionId: undefined,
            x: 0,
            y: 0,
            rotation: 0,
            scale: 1,
            contours: p.contours.map((c) => ({
              ...c,
              points: c.points.map((v) => ({ x: v.x - b.x, y: v.y - b.y })),
            })),
            materialId: sheet.materialId,
            quantity: 1,
          };
          const defaults=newPartDefaults(def,updated.materials.find(m=>m.id===sheet.materialId)!);
          Object.assign(def,defaults);
          updated.parts.push(def);
        }
        sheet.placements.push({
          id: p.id,
          partId: def.id,
          x: p.x + shift.x,
          y: p.y + shift.y,
          rotation: p.rotation,
          scale: p.scale,
        });
      }
    }
    updated.parts = updated.parts.map((p) => ({
      ...p,
      quantity: Math.max(p.quantity, placedCount(updated, p.id)),
    }));
  }
  return jobSchema.parse(updated);
}
export function jobIssues(job: Job, planner: typeof plan = plan): string[] {
  const issues: string[] = [];
  for (const p of job.parts) {
    const left = p.quantity - placedCount(job, p.id);
    if (left)
      issues.push(
        `${p.name}: ${left} of ${p.quantity} requested copies remain unplaced.`,
      );
    if (p.quantity > 0 && !p.contours.length) issues.push(`${p.name}: no geometry.`);
  }
  for (const s of job.sheets) {
    if (
      s.wcs.x < 0 ||
      s.wcs.y < 0 ||
      s.wcs.x + s.stock.width > (job.machineSettings?.width ?? BED.width) ||
      s.wcs.y + s.stock.height > (job.machineSettings?.height ?? BED.height)
    )
      issues.push(
        `${s.name}: sheet position extends beyond the maximum cutting area.`,
      );
    const material = job.materials.find((m) => m.id === s.materialId)!;
    if (material.machine !== job.machine)
      issues.push(`${s.name}: parameters belong to another machine profile.`);
    if (s.placements.length)
      issues.push(
        ...planner(sheetProject(job, s.id)).issues.map(
          (i) => `${s.name}: ${i}`,
        ),
      );
  }
  return [...new Set(issues)];
}
export { nestJob, nestJobDetailed } from "./job-nesting";

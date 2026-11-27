import type { Contour, Point, Project } from "./model";
import { effectivePierceDiameter } from "./model";
import {
  plan,
  distance,
  bounds,
  offset,
  transformed,
  type Move,
  type Plan,
} from "./geometry";
import { curvedLead, leadInStart, smallHolePierce } from "./lead-in";
import { scheduleCornerFeeds } from "./corner-feed";
import { closestOnPath, movePathStart, pointInPaths } from "./path-math";
import { jobSchema, sheetProject, BED, type Job } from "./job";
import { workOriginPoint } from "./work-origin";
import { cutFilename } from "./cut-filename";
import { overlapProfile } from "./lead-overlap";
import { reserveTabLeads, tabLeadsClear, type TabMove } from "./tab-leads";

export type CutOperation = {
  partId: string;
  contourIndex: number;
  entry: Point;
  pierce: number;
  start: Point;
  moves: Move[];
  pierceOnly?: boolean;
};
export type PostedFile = {
  sheetId: string;
  sheetName: string;
  filename: string;
  content: string;
  operations: number;
  pierceOnlyOperations?: number;
  seconds: number;
  abrasiveGrams: number;
  cutSeconds: number;
  pierceSeconds: number;
  overheadSeconds: number;
  cost: {
    currency: string;
    abrasive: number | null;
    running: number | null;
    total: number | null;
  };
  warnings: string[];
};
export class PostError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("\n"));
    this.name = "PostError";
  }
}
// Partition at boundary intersections, then test every open interval. This also
// catches a lead crossing a narrow island that point sampling could miss.
function crossesRegion(
  from: Point,
  to: Point,
  polygons: Point[][],
  inside: boolean,
) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    hits = [0, 1];
  for (const points of polygons)
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length],
        ex = b.x - a.x,
        ey = b.y - a.y;
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-10) continue;
      const ax = a.x - from.x,
        ay = a.y - from.y;
      const t = (ax * ey - ay * ex) / denominator,
        u = (ax * dy - ay * dx) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) hits.push(t);
    }
  hits.sort((a, b) => a - b);
  return hits.slice(1).some((t, i) => {
    if (t - hits[i] < 1e-9) return false;
    const at = (t + hits[i]) / 2;
    return (
      pointInPaths(polygons, { x: from.x + dx * at, y: from.y + dy * at }) ===
      inside
    );
  });
}

/** The exact operations used by both the preview and the NC writer. */
export function planForPosting(
  project: Project,
): Plan & { operations: CutOperation[] } {
  const base = plan(project),
    operations: CutOperation[] = [],
    moves: Move[] = [],
    pierces: Plan["pierces"] = [];
  const issues = base.issues.filter(
    (s) =>
      !/pierce footprint|Compensated toolpath or lead extends|Toolpath exceeds/.test(
        s,
      ),
  );
  const design = project.parts.map((p) =>
    transformed(p).flatMap((c) =>
      offset(c, c.closed ? (p.stockToLeave ?? 0) * (c.hole ? -1 : 1) : 0),
    ),
  );
  const designBounds = design.map((contours) =>
    bounds(contours.flatMap((c) => c.points)),
  );
  let cursor: Point = { x: 0, y: 0 },
    minutes = 0,
    abrasiveGrams = 0;
  for (const cp of base.contourPlans) {
    const { contour, process, partId } = cp;
    const own = project.parts.find((p) => p.id === partId)!;
    const centerAllowed =
      !cp.moves.some((m) => m.kind === "tab") &&
      !transformed(own).some(
        (other, i) =>
          i !== cp.contourIndex &&
          other.closed &&
          pointInPaths([contour.points], other.points[0]),
      );
    // The base plan begins with a rapid and, for compensated paths, a lead.
    const hasLead =
      !cp.pierceOnly &&
      project.parts.find((p) => p.id === partId) &&
      (contour.cut ?? project.parts.find((p) => p.id === partId)!.cut) !==
        "centerline" &&
      process.lead > 0;
    const lead = hasLead ? process.lead : 0;
    let segments = cp.moves.slice(hasLead ? 2 : 1);
    if (cp.pierceOnly) {
      const center = cp.moves[0].to;
      segments = [
        { from: center, to: center, kind: "cut", partId, feed: process.feed },
      ];
    }
    if (
      contour.closed &&
      contour.startPosition === undefined &&
      segments.some((m) => m.kind === "tab")
    ) {
      const at = segments.findIndex(
        (m, i) =>
          m.kind === "cut" &&
          segments[(i + segments.length - 1) % segments.length].kind === "tab",
      );
      if (at >= 0) segments = [...segments.slice(at), ...segments.slice(0, at)];
    }
    if (
      hasLead &&
      process.leadStyle !== "straight" &&
      segments.some((m) => m.kind === "tab")
    ) {
      segments = reserveTabLeads(
        segments,
        (lead * 2) / Math.PI +
          Math.max(0, (effectivePierceDiameter(process) - process.kerf) / 2),
        process.kerf,
      );
      cp.moves = [...cp.moves.slice(0, hasLead ? 2 : 1), ...segments];
    }
    if (!cp.pierceOnly)
      segments = overlapProfile(
        segments,
        contour.closed,
        process.leadInOverlap,
        process.leadOutOverlap,
      );
    const at = (p: Point): Contour => ({
      ...contour,
      points: movePathStart(contour.points, p),
    });
    const leadPath = (p: Point, exit: boolean, requested = lead) => {
      if (cp.pierceOnly) return [p];
      const draw = (length: number) =>
        process.leadStyle === "straight"
          ? exit
            ? [p, leadInStart(at(p), length, centerAllowed)]
            : [leadInStart(at(p), length, centerAllowed), p]
          : curvedLead(at(p), length, exit, centerAllowed);
      if (centerAllowed) return draw(requested);
      const retained = design[project.parts.findIndex((p) => p.id === partId)]
        .filter((c) => c.closed)
        .map((c) => c.points);
      for (let i = 0; i < 16; i++) {
        const path = draw(requested * 0.5 ** i),
          pierce = exit ? path.at(-1)! : path[0];
        if (
          !pointInPaths(retained, pierce) &&
          path
            .slice(1)
            .every((to, i) => !crossesRegion(path[i], to, retained, true))
        )
          return path;
      }
      return [p];
    };
    const groups: { kind: string; moves: TabMove[] }[] = [];
    for (const move of segments) {
      const last = groups.at(-1);
      if (last?.kind === move.kind) last.moves.push(move);
      else groups.push({ kind: move.kind, moves: [move] });
    }
    if (
      groups.length > 1 &&
      groups[0].kind === "tab" &&
      groups.at(-1)!.kind === "tab"
    ) {
      groups[0].moves = [...groups.pop()!.moves, ...groups[0].moves];
    }
    const spans = groups.flatMap((g, index) =>
      g.kind === "cut" ? [{ group: index, cut: g.moves }] : [],
    );
    const prepared = spans.map(({ group, cut }) => ({
      group,
      cut,
      entry: cut[0].from,
      end: cut.at(-1)!.to,
      entryLength: lead,
      exitLength: lead,
      entryPath: leadPath(cut[0].from, false),
      exitPath: leadPath(cut.at(-1)!.to, true),
    }));
    if (
      hasLead &&
      process.leadStyle !== "straight" &&
      groups.some((g) => g.kind === "tab")
    ) {
      if (!prepared.length)
        issues.push(
          "Retaining tabs and leads consume the entire contour. Reduce tab count, width or lead length.",
        );
      let reduced = false;
      for (const previous of prepared) {
        const gapIndex = (previous.group + 1) % groups.length,
          gap = groups[gapIndex];
        if (gap.kind !== "tab") continue;
        const next = prepared.find(
          (p) => p.group === (gapIndex + 1) % groups.length,
        );
        if (!next) continue;
        const width = Math.max(
          ...gap.moves.map((m) => m.bridgeWidth ?? process.tabWidth),
        );
        for (let attempt = 0; attempt < 18; attempt++) {
          if (
            tabLeadsClear(
              previous.exitPath,
              next.entryPath,
              process.kerf,
              effectivePierceDiameter(process),
              width,
            )
          )
            break;
          reduced = true;
          previous.exitLength *= 0.5;
          next.entryLength *= 0.5;
          previous.exitPath = leadPath(previous.end, true, previous.exitLength);
          next.entryPath = leadPath(next.entry, false, next.entryLength);
        }
        if (
          !tabLeadsClear(
            previous.exitPath,
            next.entryPath,
            process.kerf,
            effectivePierceDiameter(process),
            width,
          )
        )
          issues.push(
            "Retaining tab clearance cannot be preserved. Move the tab or reduce tab width, lead length, tab count or pierce diameter.",
          );
      }
      if (reduced)
        issues.push("Lead length reduced to preserve retaining tabs.");
    }
    for (const {
      cut,
      entry,
      end,
      entryPath,
      exitPath,
      entryLength,
      exitLength,
    } of prepared) {
      const start = entryPath[0],
        exit = exitPath.at(-1)!;
      const asMoves = (points: Point[]): Move[] =>
        points.slice(1).flatMap((to, i) =>
          distance(points[i], to) > 1e-8
            ? [
                {
                  from: points[i],
                  to,
                  kind: "cut" as const,
                  partId,
                  feed: process.feed,
                },
              ]
            : [],
        );
      const entryMoves = asMoves(entryPath),
        exitMoves = asMoves(exitPath);
      const unscheduled = [
        ...entryMoves,
        ...(cp.pierceOnly ? [] : cut),
        ...exitMoves,
      ];
      const cutting =
        process.cornerSlowdown === false
          ? unscheduled
          : scheduleCornerFeeds(unscheduled, process.feed);
      const leads = [...entryMoves, ...exitMoves];
      if (
        leads.some((line) =>
          design.some(
            (paths, i) =>
              project.parts[i].id !== partId &&
              Math.max(line.from.x, line.to.x) >= designBounds[i].x &&
              Math.min(line.from.x, line.to.x) <=
                designBounds[i].x + designBounds[i].width &&
              Math.max(line.from.y, line.to.y) >= designBounds[i].y &&
              Math.min(line.from.y, line.to.y) <=
                designBounds[i].y + designBounds[i].height &&
              crossesRegion(
                line.from,
                line.to,
                paths.filter((c) => c.closed).map((c) => c.points),
                true,
              ),
          ),
        )
      )
        issues.push(
          "A lead crosses retained material of another part. Move the entry point or increase part spacing.",
        );
      const radius = effectivePierceDiameter(process) / 2;
      const footprint = (p: Point) =>
        radius > 0 &&
        design.some(
          (contours, i) =>
            p.x >= designBounds[i].x - radius &&
            p.x <= designBounds[i].x + designBounds[i].width + radius &&
            p.y >= designBounds[i].y - radius &&
            p.y <= designBounds[i].y + designBounds[i].height + radius &&
            (pointInPaths(
              contours.filter((c) => c.closed).map((c) => c.points),
              p,
            ) ||
              contours.some(
                (c) =>
                  closestOnPath(c.points, c.closed, p).distance <
                  radius - 0.0002,
              )),
        );
      const warning = footprint(start);
      if (warning || footprint(exit))
        issues.push(
          `${project.parts.find((p) => p.id === partId)?.name}: pierce or stop footprint may alter a finished cut profile. Increase lead length or move the entry.`,
        );
      if (
        !(centerAllowed && smallHolePierce(at(entry), lead)) &&
        (entryMoves.reduce((n, m) => n + distance(m.from, m.to), 0) <
          entryLength * 0.995 ||
          exitMoves.reduce((n, m) => n + distance(m.from, m.to), 0) <
            exitLength * 0.995)
      )
        issues.push("Lead length reduced to remain within scrap.");
      pierces.push({ point: start, radius, partId, warning });
      moves.push(
        { from: cursor, to: start, kind: "rapid", partId },
        ...cutting,
      );
      operations.push({
        partId,
        contourIndex: cp.contourIndex,
        entry,
        pierce: process.pierce,
        start,
        moves: cutting,
        ...(cp.pierceOnly ? { pierceOnly: true } : {}),
      });
      cursor = exit;
      const cuttingMinutes = cutting.reduce(
        (n, m) => n + distance(m.from, m.to) / (m.feed ?? process.feed),
        0,
      );
      minutes += cuttingMinutes + (process.pierce + 3) / 60;
      abrasiveGrams +=
        (cuttingMinutes + (process.pierce + 1) / 60) *
        (project.machineSettings?.abrasive ?? process.abrasive ?? 0);
      const points = [...entryPath, ...exitPath];
      if (
        points.some(
          (p) =>
            p.x - radius < -0.0002 ||
            p.y - radius < -0.0002 ||
            p.x + radius > project.stock.width + 0.0002 ||
            p.y + radius > project.stock.height + 0.0002,
        )
      )
        issues.push("Pierce or stop footprint extends outside the stock.");
      const machine = project.machineSettings ?? BED;
      if (
        points.some(
          (p) =>
            p.x + (project.bedOffset?.x ?? 0) - radius < -0.0002 ||
            p.y + (project.bedOffset?.y ?? 0) - radius < -0.0002 ||
            p.x + (project.bedOffset?.x ?? 0) + radius >
              machine.width + 0.0002 ||
            p.y + (project.bedOffset?.y ?? 0) + radius >
              machine.height + 0.0002,
        )
      )
        issues.push(
          "Pierce or stop footprint exceeds the machine cutting area.",
        );
      const restrictions = [
        ...(project.stock.outline ? [project.stock.outline] : []),
        ...(project.stock.exclusions ?? []),
      ];
      for (const polygon of restrictions) {
        const isOutline = polygon === project.stock.outline;
        if (
          cutting.some((m) =>
            crossesRegion(m.from, m.to, [polygon], !isOutline),
          ) ||
          points.some(
            (p) =>
              pointInPaths([polygon], p) !== isOutline ||
              closestOnPath(polygon, true, p).distance < radius - 0.0002,
          )
        )
          issues.push(
            isOutline
              ? "Cutting or pierce footprint leaves the stock outline."
              : "Cutting or pierce footprint intersects a stock exclusion.",
          );
      }
    }
    // Tabs are drawn as gaps, and are never emitted as powered motion.
    moves.push(...segments.filter((m) => m.kind === "tab"));
  }
  const cuttingPoints = moves
    .filter((m) => m.kind !== "rapid")
    .flatMap((m) => [m.from, m.to]);
  if (
    cuttingPoints.some(
      (p) =>
        p.x < -0.0002 ||
        p.y < -0.0002 ||
        p.x > project.stock.width + 0.0002 ||
        p.y > project.stock.height + 0.0002,
    )
  )
    issues.push("Cutting or lead motion extends outside the stock.");
  const machine = project.machineSettings ?? BED;
  if (
    cuttingPoints.some((p) => {
      const x = p.x + (project.bedOffset?.x ?? 0),
        y = p.y + (project.bedOffset?.y ?? 0);
      return (
        x < -0.0002 ||
        y < -0.0002 ||
        x > machine.width + 0.0002 ||
        y > machine.height + 0.0002
      );
    })
  )
    issues.push("Toolpath exceeds the machine cutting area.");
  return {
    ...base,
    operations,
    moves,
    pierces,
    minutes,
    abrasiveGrams,
    issues: [...new Set(issues)],
    cutLength: moves
      .filter((m) => m.kind === "cut")
      .reduce((n, m) => n + distance(m.from, m.to), 0),
  };
}
const number = (n: number) => {
  if (!Number.isFinite(n)) throw new PostError(["Non-finite NC value"]);
  return (Math.abs(n) < 0.00005 ? 0 : n).toFixed(4).replace(/\.?0+$/, "");
};
const text = (s: string) =>
  s.replace(/[^A-Za-z0-9 _.,:/+\-]/g, " ").slice(0, 80);
const clock = (seconds: number) => {
  const s = Math.ceil(seconds);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};

/** Generate all requested files before offering a destination or writing anything. */
export function postJob(value: Job, sheetId?: string): PostedFile[] {
  const job = jobSchema.parse(value);
  const selected = sheetId
    ? job.sheets.filter((s) => s.id === sheetId)
    : job.sheets.filter((s) => s.placements.length);
  if (!selected.length)
    throw new PostError([
      sheetId
        ? "This sheet has no placed parts."
        : "There are no populated sheets to post.",
    ]);
  if (!sheetId) {
    const missing = job.parts.filter(
      (p) =>
        job.sheets.reduce(
          (n, s) => n + s.placements.filter((i) => i.partId === p.id).length,
          0,
        ) < p.quantity,
    );
    if (missing.length)
      throw new PostError(
        missing.map(
          (p) => `${p.name}: not all requested copies have been placed.`,
        ),
      );
  }
  const files: PostedFile[] = [],
    errors: string[] = [];
  for (const sheet of selected) {
    if (!sheet.placements.length) {
      errors.push(`${sheet.name}: no placed parts.`);
      continue;
    }
    const usedMaterials = new Set([
      sheet.materialId,
      ...sheet.placements.map(
        (i) => job.parts.find((p) => p.id === i.partId)!.materialId,
      ),
    ]);
    if (
      job.materials.some(
        (m) => usedMaterials.has(m.id) && m.machine !== job.machine,
      )
    ) {
      errors.push(
        `${sheet.name}: cutting settings belong to a different machine model.`,
      );
      continue;
    }
    const project = sheetProject(job, sheet.id),
      prepared = planForPosting(project);
    const blocking = prepared.issues.filter(
      (s) => !/lead length reduced|pierce or stop footprint may alter/i.test(s),
    );
    if (!prepared.operations.length) blocking.push("No cuttable toolpaths.");
    for (const part of project.parts)
      if (
        !Number.isFinite((part.process ?? project.material).feed) ||
        Number(number((part.process ?? project.material).feed)) <= 0
      )
        blocking.push(
          `${part.name}: cut feed must remain positive at 0.0001 mm/min output precision.`,
        );
    if (blocking.length) {
      errors.push(...blocking.map((s) => `${sheet.name}: ${s}`));
      continue;
    }
    const bed = (p: Point) => ({
      x: p.x + sheet.wcs.x,
      y: -(p.y + sheet.wcs.y),
    });
    const xy = (p: Point) => {
      const b = bed(p);
      return `X${number(b.x)} Y${number(b.y)}`;
    };
    const b = bounds(
      prepared.operations.flatMap((op) => {
        const process =
          project.parts.find((p) => p.id === op.partId)?.process ??
          project.material;
        const radius = Math.max(
          process.kerf / 2,
          effectivePierceDiameter(process) / 2,
        );
        return [op.start, ...op.moves.flatMap((m) => [m.from, m.to])].flatMap(
          (p) => [
            { x: p.x - radius, y: p.y - radius },
            { x: p.x + radius, y: p.y + radius },
          ],
        );
      }),
    );
    const maxPierce = prepared.operations.reduce(
      (n, op) => Math.max(n, op.pierce),
      0,
    );
    const machine = project.machineSettings ?? BED;
    if (
      b.x < -0.0002 ||
      b.y < -0.0002 ||
      b.x + b.width > sheet.stock.width + 0.0002 ||
      b.y + b.height > sheet.stock.height + 0.0002 ||
      b.x + sheet.wcs.x < -0.0002 ||
      b.y + sheet.wcs.y < -0.0002 ||
      b.x + b.width + sheet.wcs.x > machine.width + 0.0002 ||
      b.y + b.height + sheet.wcs.y > machine.height + 0.0002
    ) {
      errors.push(
        `${sheet.name}: cut extents including the jet footprint exceed the stock or machine cutting area.`,
      );
      continue;
    }
    const origin = workOriginPoint(sheet, project.parts);
    const lines = [
      "; Generated by Wam Local",
      `; Job: ${text(job.name)}`,
      `; Sheet: ${text(sheet.name)}`,
      `; Machine: ${job.machine === "pro" ? "WAZER Pro" : "WAZER Desktop"}`,
      "; Coordinates: absolute machine bed, millimeters, Y negative down",
      `; Sheet origin on bed: ${number(sheet.wcs.x + origin.x)}, ${number(sheet.wcs.y + origin.y)} mm (${sheet.workOrigin ?? "top-left"}${sheet.workOriginReference === "parts" ? ", parts bounds" : ""})`,
      "; Per-part feed and pierce settings; scrap-side leads",
      "; Cut time excludes rapid travel; resume pierce uses the sheet maximum",
      "G90",
      "G21",
      "M1403",
      `M1405 ${xy({ x: b.x, y: b.y })}`,
      `M1406 ${xy({ x: b.x + b.width, y: b.y + b.height })}`,
      `M1407 S${number(maxPierce)}`,
      `M1410 ${job.machine === "pro" ? "2.5.0" : "1.4"}; Controller dialect; generated by Wam Local`,
      `M1411 ${text(job.materials.find((m) => m.id === sheet.materialId)?.stockKey ?? project.material.name)}`,
      `M1412 ${number(project.material.thickness)} mm`,
    ];
    for (const op of prepared.operations) {
      lines.push(`G0 ${xy(op.start)}`, "M3", "M8", `G4 S${number(op.pierce)}`);
      for (const move of op.moves)
        lines.push(
          `G1 ${xy(move.to)} F${number(move.feed ?? project.material.feed)}`,
        );
      lines.push("G4 S1", "M9", "G4 S1", "M5", "G4 S1");
    }
    lines.push(`M1413 ${clock(prepared.minutes * 60)}`, "M1404", "");
    const index = job.sheets.findIndex((s) => s.id === sheet.id) + 1;
    files.push({
      sheetId: sheet.id,
      sheetName: sheet.name,
      filename: cutFilename(job.name, index, job.sheets.length),
      content: lines.join("\r\n"),
      operations: prepared.operations.length,
      pierceOnlyOperations: prepared.operations.filter((op) => op.pierceOnly)
        .length,
      seconds: Math.ceil(prepared.minutes * 60),
      abrasiveGrams: prepared.abrasiveGrams,
      cutSeconds: prepared.operations
        .flatMap((o) => o.moves)
        .reduce(
          (n, m) =>
            n +
            (60 * distance(m.from, m.to)) / (m.feed ?? project.material.feed),
          0,
        ),
      pierceSeconds: prepared.operations.reduce((n, o) => n + o.pierce, 0),
      overheadSeconds: prepared.operations.length * 3,
      cost: (() => {
        const settings = project.machineSettings;
        const abrasive =
          settings?.abrasiveCostPerKg === undefined
            ? null
            : (prepared.abrasiveGrams / 1000) * settings.abrasiveCostPerKg;
        const running =
          settings?.runningCostPerHour === undefined
            ? null
            : (prepared.minutes / 60) * settings.runningCostPerHour;
        return {
          currency: settings?.currency ?? "USD",
          abrasive,
          running,
          total:
            abrasive === null || running === null ? null : abrasive + running,
        };
      })(),
      warnings: [
        ...prepared.issues,
        ...(new Set(prepared.operations.map((op) => op.pierce)).size > 1
          ? [
              `Resume after pause uses ${maxPierce} seconds, the maximum pierce time on this sheet.`,
            ]
          : []),
      ],
    });
  }
  if (errors.length) throw new PostError([...new Set(errors)]);
  return files;
}

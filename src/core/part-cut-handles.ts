import type { Contour, Part, Point, Project } from "./model";
import { distance, transformed } from "./geometry";
import { closestOnPath, pointOnPath } from "./path-math";
import type { planForPosting } from "./postprocessor";
type Preview = ReturnType<typeof planForPosting>;

/** Project compensated automatic gaps onto the editable source contour. */
export function editableTabs(
  part: Part,
  index: number,
  preview: Preview,
): NonNullable<Contour["tabs"]> {
  const raw = part.contours[index];
  if (!raw.closed || raw.tabMode === "none") return [];
  if (raw.tabMode === "manual") return structuredClone(raw.tabs ?? []);
  const contour = transformed(part)[index],
    groups: Point[][] = [];
  for (const cp of preview.contourPlans.filter(
    (cp) => cp.partId === part.id && cp.contourIndex === index,
  )) {
    for (const move of cp.moves.filter((m) => m.kind === "tab")) {
      const last = groups.at(-1);
      if (last && distance(last.at(-1)!, move.from) < 1e-7) last.push(move.to);
      else groups.push([move.from, move.to]);
    }
  }
  if (
    groups.length > 1 &&
    distance(groups.at(-1)!.at(-1)!, groups[0][0]) < 1e-7
  ) {
    groups[0] = [...groups.pop()!, ...groups[0].slice(1)];
  }
  const process = preview.contourPlans.find(
    (cp) => cp.partId === part.id && cp.contourIndex === index,
  )?.process;
  return groups.map((points) => ({
    position: closestOnPath(
      contour.points,
      true,
      pointOnPath(points, false, 0.5),
    ).fraction,
    width: process?.tabWidth ?? 0.254,
  }));
}

export type CutDrag =
  | {
      kind: "tab";
      contourIndex: number;
      tabIndex: number;
      tabs: NonNullable<Contour["tabs"]>;
    }
  | {
      kind: "entry" | "lead";
      contourIndex: number;
      entryFraction: number;
      entryPoint?: Point;
      offset?: Point;
    };
export function moveCutHandle(
  part: Part,
  drag: CutDrag,
  at: Point,
  project: Project,
): Part {
  const contour = transformed(part)[drag.contourIndex],
    raw = part.contours[drag.contourIndex];
  if (
    !raw.closed ||
    (drag.kind === "lead" && (raw.cut ?? part.cut) === "centerline")
  )
    return part;
  let change: Partial<Contour>;
  if (drag.kind === "tab") {
    const fraction = closestOnPath(contour.points, true, at).fraction;
    change = {
      tabMode: "manual",
      tabs: drag.tabs.map((t, i) =>
        i === drag.tabIndex ? { ...t, position: fraction } : t,
      ),
    };
  } else if (drag.kind === "entry")
    change = {
      startPosition: closestOnPath(contour.points, true, {
        x: at.x - (drag.offset?.x ?? 0),
        y: at.y - (drag.offset?.y ?? 0),
      }).fraction,
    };
  else {
    const entry =
      drag.entryPoint ?? pointOnPath(contour.points, true, drag.entryFraction);
    at = { x: at.x - (drag.offset?.x ?? 0), y: at.y - (drag.offset?.y ?? 0) };
    const style = (part.process ?? project.material).leadStyle ?? "arc";
    const length =
      distance(entry, at) * (style === "arc" ? Math.PI / (2 * Math.SQRT2) : 1);
    change = { lead: Number(Math.max(0, Math.min(30, length)).toFixed(5)) };
  }
  return {
    ...part,
    contours: part.contours.map((c, i) =>
      i === drag.contourIndex ? { ...c, ...change } : c,
    ),
  };
}

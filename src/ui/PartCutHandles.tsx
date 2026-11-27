import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { Part, Point, Project } from "../core/model";
import { transformed } from "../core/geometry";
import { closestOnPath, pointOnPath } from "../core/path-math";
import { planForPosting } from "../core/postprocessor";
import {
  editableTabs,
  moveCutHandle,
  type CutDrag,
} from "../core/part-cut-handles";
import { useDisplayUnits } from "./display-units";

export function PartCutHandles({
  part,
  project,
  preview,
  pixelsPerMm,
  onSelect,
  onChange,
}: {
  part: Part;
  project: Project;
  preview: ReturnType<typeof planForPosting>;
  pixelsPerMm: number;
  onSelect: (index: number) => void;
  onChange: (part: Part) => void;
}) {
  const u = useDisplayUnits(),
    [draft, setDraft] = useState<Part | null>(null);
  const layer = useRef<SVGGElement>(null);
  const [activeTab, setActiveTab] = useState<{
    contourIndex: number;
    tabIndex: number;
  } | null>(null);
  useEffect(() => {
    const clear = (e: globalThis.PointerEvent) => {
      if (!layer.current?.contains(e.target as Node)) setActiveTab(null);
    };
    window.addEventListener("pointerdown", clear, true);
    return () => window.removeEventListener("pointerdown", clear, true);
  }, []);
  const drag = useRef<{
    part: Part;
    handle: CutDrag;
    start: Point;
    moved: boolean;
    draft?: Part;
    target: Element;
    pointerId: number;
  } | null>(null);
  const shown = draft ?? part;
  const planned = useMemo(() => {
    try {
      return draft ? planForPosting({ ...project, parts: [draft] }) : preview;
    } catch {
      return null;
    }
  }, [draft, preview, project]);
  if (!planned?.operations || !planned.contourPlans) return null;
  const contours = transformed(shown),
    size = 5 / Math.max(0.01, pixelsPerMm);
  const point = (e: PointerEvent) => {
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!,
      matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    return {
      x: p.x - (project.bedOffset?.x ?? 0),
      y: p.y - (project.bedOffset?.y ?? 0),
    };
  };
  const begin = (e: PointerEvent, handle: CutDrag) => {
    if (e.button !== 0 || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(handle.contourIndex);
    drag.current = {
      part: structuredClone(part),
      handle,
      start: { x: e.clientX, y: e.clientY },
      moved: false,
      target: e.currentTarget,
      pointerId: e.pointerId,
    };
    (e.currentTarget as SVGElement).focus();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const finish = (e: PointerEvent, cancel = false) => {
    if (!drag.current) return;
    e.preventDefault();
    e.stopPropagation();
    const d = drag.current;
    if (!cancel && d.moved && d.draft) onChange(d.draft);
    drag.current = null;
    setDraft(null);
    if (d.target.hasPointerCapture(d.pointerId))
      d.target.releasePointerCapture(d.pointerId);
  };
  return (
    <g
      ref={layer}
      tabIndex={-1}
      data-layer="part-cut-handles"
      onFocus={(e) => {
        const handle = (e.target as Element)
          .closest("[data-tab-handle]")
          ?.getAttribute("data-tab-handle");
        if (handle) {
          const [contourIndex, tabIndex] = handle.split("-").map(Number);
          setActiveTab({ contourIndex, tabIndex });
        } else if (e.target !== layer.current) setActiveTab(null);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setActiveTab(null);
      }}
      onKeyDown={(e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && activeTab) {
          e.preventDefault();
          e.stopPropagation();
          const { contourIndex, tabIndex } = activeTab;
          if (tabIndex < 0) return;
          const tabs = editableTabs(shown, contourIndex, planned);
          if (!tabs[tabIndex]) return;
          const d = drag.current;
          if (d?.target.hasPointerCapture(d.pointerId))
            d.target.releasePointerCapture(d.pointerId);
          drag.current = null;
          setDraft(null);
          onChange({
            ...shown,
            contours: shown.contours.map((c, i) =>
              i === contourIndex
                ? {
                    ...c,
                    tabMode: "manual",
                    tabs: tabs.filter((_, i) => i !== tabIndex),
                  }
                : c,
            ),
          });
          // Keep keyboard focus in the tab layer after removal. A held Delete
          // must not fall through to the part when the removed handle unmounts.
          setActiveTab({ contourIndex, tabIndex: -1 });
          layer.current?.focus();
          return;
        }
        if (e.key === "Escape" && drag.current) {
          e.preventDefault();
          e.stopPropagation();
          const d = drag.current;
          drag.current = null;
          setDraft(null);
          if (d.target.hasPointerCapture(d.pointerId))
            d.target.releasePointerCapture(d.pointerId);
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        e.stopPropagation();
        if (
          !d.moved &&
          Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 2
        )
          return;
        d.moved = true;
        d.draft = moveCutHandle(d.part, d.handle, point(e), project);
        setDraft(d.draft);
      }}
      onPointerUp={(e) => finish(e)}
      onPointerCancel={(e) => finish(e, true)}
    >
      {contours.flatMap((c, ci) => {
        if (!c.closed) return [];
        const tabs = editableTabs(shown, ci, planned),
          op = planned.operations.find(
            (op) => op.partId === part.id && op.contourIndex === ci,
          );
        const fraction =
          shown.contours[ci].startPosition ??
          (op ? closestOnPath(c.points, true, op.entry).fraction : 0);
        const entry = pointOnPath(c.points, true, fraction);
        const supportsLead =
          (shown.contours[ci].cut ?? shown.cut) !== "centerline";
        const lead = supportsLead
          ? (shown.contours[ci].lead ??
            (shown.process ?? project.material).lead)
          : 0;
        const leadAt = op?.start ?? entry,
          dx = leadAt.x - entry.x,
          dy = leadAt.y - entry.y;
        const distance = Math.hypot(dx, dy),
          direction = {
            x: distance ? dx / distance : 1,
            y: distance ? dy / distance : 0,
          };
        const crowded = tabs.some((t) => {
          const at = pointOnPath(c.points, true, t.position);
          return Math.hypot(at.x - entry.x, at.y - entry.y) < 3 * size;
        });
        const entryOffset =
          drag.current?.handle.kind === "entry" &&
          drag.current.handle.contourIndex === ci
            ? (drag.current.handle.offset ?? { x: 0, y: 0 })
            : {
                x: crowded ? direction.x * 3 * size : 0,
                y: crowded ? direction.y * 3 * size : 0,
              };
        const entryHandle = {
          x: entry.x + entryOffset.x,
          y: entry.y + entryOffset.y,
        };
        const reach = Math.max(
          distance,
          (Math.hypot(entryOffset.x, entryOffset.y) > 0 ? 6 : 3) * size,
        );
        const handleAt = {
          x: entry.x + direction.x * reach,
          y: entry.y + direction.y * reach,
        };
        return [
          <g key={`contour-${ci}`}>
            {tabs.map((t, ti) => {
              const at = pointOnPath(c.points, true, t.position);
              return (
                <g key={`tab-${ti}`}>
                  <circle
                    role="button"
                    tabIndex={0}
                    aria-label={`Drag tab ${ti + 1} contour ${ci + 1}`}
                    aria-pressed={
                      activeTab?.contourIndex === ci &&
                      activeTab.tabIndex === ti
                    }
                    data-tab-handle={`${ci}-${ti}`}
                    cx={at.x}
                    cy={at.y}
                    r={size}
                    fill="#f5ce6c"
                    stroke={
                      activeTab?.contourIndex === ci &&
                      activeTab.tabIndex === ti
                        ? "#fff"
                        : "#18232a"
                    }
                    strokeWidth={1 / pixelsPerMm}
                    style={{ cursor: "grab", touchAction: "none" }}
                    onPointerDown={(e) =>
                      begin(e, {
                        kind: "tab",
                        contourIndex: ci,
                        tabIndex: ti,
                        tabs,
                      })
                    }
                  >
                    <title>Drag tab · {u.length(t.width)}</title>
                  </circle>
                </g>
              );
            })}
            <line
              x1={entry.x}
              y1={entry.y}
              x2={entryHandle.x}
              y2={entryHandle.y}
              stroke="#86d0df"
              strokeDasharray="2 2"
              strokeWidth={1 / pixelsPerMm}
              pointerEvents="none"
            />
            <circle
              role="button"
              tabIndex={0}
              aria-label={`Drag ${supportsLead ? "lead-in" : "cut"} entry contour ${ci + 1}`}
              data-entry-handle={ci}
              cx={entryHandle.x}
              cy={entryHandle.y}
              r={size}
              fill="#86d0df"
              stroke="#17232b"
              strokeWidth={1 / pixelsPerMm}
              style={{ cursor: "grab", touchAction: "none" }}
              onPointerDown={(e) =>
                begin(e, {
                  kind: "entry",
                  contourIndex: ci,
                  entryFraction: fraction,
                  offset: { x: point(e).x - entry.x, y: point(e).y - entry.y },
                })
              }
            >
              <title>Drag entry along profile</title>
            </circle>
            {supportsLead &&
              (lead > 0 ||
                (drag.current?.handle.kind === "lead" &&
                  drag.current.handle.contourIndex === ci)) &&
              op && (
                <g>
                  <line
                    x1={entry.x}
                    y1={entry.y}
                    x2={handleAt.x}
                    y2={handleAt.y}
                    stroke="#86d0df"
                    strokeWidth={1 / pixelsPerMm}
                    pointerEvents="none"
                  />
                  <rect
                    role="button"
                    tabIndex={0}
                    aria-label={`Drag lead-in length contour ${ci + 1}`}
                    data-lead-handle={ci}
                    x={handleAt.x - size}
                    y={handleAt.y - size}
                    width={2 * size}
                    height={2 * size}
                    fill="#b6e5ed"
                    stroke="#17232b"
                    strokeWidth={1 / pixelsPerMm}
                    style={{ cursor: "ew-resize", touchAction: "none" }}
                    onPointerDown={(e) =>
                      begin(e, {
                        kind: "lead",
                        contourIndex: ci,
                        entryFraction: fraction,
                        entryPoint: op.entry,
                        offset: {
                          x: point(e).x - op.start.x,
                          y: point(e).y - op.start.y,
                        },
                      })
                    }
                  >
                    <title>Drag lead-in length · {u.length(lead)}</title>
                  </rect>
                </g>
              )}
          </g>,
        ];
      })}
    </g>
  );
}

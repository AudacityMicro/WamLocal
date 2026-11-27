// @vitest-environment happy-dom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PartCutHandles } from "./PartCutHandles";
import { newProject, makePart, rectangle } from "../core/model";
import { planForPosting } from "../core/postprocessor";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "DOMPoint",
    class {
      constructor(
        public x: number,
        public y: number,
      ) {}
      matrixTransform() {
        return this;
      }
    },
  );
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ inverse: () => ({}) }),
  });
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(Element.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function pointer(el: Element, type: string, x: number, y: number) {
  await act(() =>
    el.dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: 1,
        bubbles: true,
      }),
    ),
  );
}
async function fixture(tabs = 2) {
  const project = newProject(),
    part = makePart("plate", [rectangle(40, 30)], 30, 30),
    commit = vi.fn();
  project.parts = [part];
  project.material = {
    ...project.material,
    kerf: 0,
    leadStyle: "straight",
    tabCount: tabs,
  };
  const preview = planForPosting(project);
  await act(() =>
    root.render(
      <svg>
        <PartCutHandles
          part={part}
          project={project}
          preview={preview}
          pixelsPerMm={1}
          onSelect={vi.fn()}
          onChange={commit}
        />
      </svg>,
    ),
  );
  return { project, part, preview, commit };
}
it("previews tab movement and commits one contour override on drop", async () => {
  const { commit } = await fixture(),
    handle = host.querySelector('[data-tab-handle="0-0"]')!;
  await pointer(
    handle,
    "pointerdown",
    Number(handle.getAttribute("cx")),
    Number(handle.getAttribute("cy")),
  );
  await pointer(handle, "pointermove", 70, 40);
  expect(commit).not.toHaveBeenCalled();
  await pointer(handle, "pointerup", 70, 40);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0][0].contours[0].tabMode).toBe("manual");
  expect(commit.mock.calls[0][0].contours[0].tabs[0].position).toBeCloseTo(
    50 / 140,
    8,
  );
});
it.each(["Delete", "Backspace"])(
  "removes the selected automatic tab with %s and consumes repeats without deleting the part",
  async (key) => {
    const { commit, part } = await fixture(1),
      handle = host.querySelector('[data-tab-handle="0-0"]')!;
    const removePart = vi.fn();
    window.addEventListener("keydown", removePart);
    try {
      await pointer(
        handle,
        "pointerdown",
        Number(handle.getAttribute("cx")),
        Number(handle.getAttribute("cy")),
      );
      await pointer(
        handle,
        "pointerup",
        Number(handle.getAttribute("cx")),
        Number(handle.getAttribute("cy")),
      );
      await act(() =>
        handle.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit.mock.calls[0][0].id).toBe(part.id);
      expect(commit.mock.calls[0][0].contours[0]).toMatchObject({
        tabMode: "manual",
        tabs: [],
      });
      const layer = host.querySelector('[data-layer="part-cut-handles"]')!;
      await act(() =>
        layer.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
            repeat: true,
          }),
        ),
      );
      expect(commit).toHaveBeenCalledTimes(1);
      expect(removePart).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", removePart);
    }
  },
);
it("separates adjacent tab and entry targets and hides unused centerline lead lengths", async () => {
  await fixture();
  const entry = host.querySelector('[data-entry-handle="0"]')!,
    lead = host.querySelector('[data-lead-handle="0"]')!;
  const x = Number(entry.getAttribute("cx")),
    y = Number(entry.getAttribute("cy"));
  for (const tab of host.querySelectorAll("[data-tab-handle]"))
    expect(
      Math.hypot(
        Number(tab.getAttribute("cx")) - x,
        Number(tab.getAttribute("cy")) - y,
      ),
    ).toBeGreaterThan(10);
  expect(
    Math.hypot(
      Number(lead.getAttribute("x")) + 5 - x,
      Number(lead.getAttribute("y")) + 5 - y,
    ),
  ).toBeGreaterThan(10);
  const project = newProject(),
    part = {
      ...makePart("centerline", [rectangle(30, 20)], 30, 30),
      cut: "centerline" as const,
    };
  project.parts = [part];
  await act(() =>
    root.render(
      <svg>
        <PartCutHandles
          part={part}
          project={project}
          preview={planForPosting(project)}
          pixelsPerMm={1}
          onSelect={vi.fn()}
          onChange={vi.fn()}
        />
      </svg>,
    ),
  );
  expect(host.querySelectorAll("[data-lead-handle]")).toHaveLength(0);
  expect(host.querySelectorAll("[data-entry-handle]")).toHaveLength(1);
});
it("drags lead-in length with no tabs and cancels a later drag without committing", async () => {
  const { commit, preview } = await fixture(0);
  expect(host.querySelectorAll("[data-tab-handle]")).toHaveLength(0);
  const handle = host.querySelector('[data-lead-handle="0"]')!,
    entry = preview.operations[0].entry,
    start = preview.operations[0].start;
  const at = {
      x: Number(handle.getAttribute("x")) + 5,
      y: Number(handle.getAttribute("y")) + 5,
    },
    d = Math.hypot(start.x - entry.x, start.y - entry.y);
  const to = {
    x: at.x + (start.x - entry.x) * (5 / d - 1),
    y: at.y + (start.y - entry.y) * (5 / d - 1),
  };
  await pointer(handle, "pointerdown", at.x, at.y);
  await pointer(handle, "pointermove", to.x, to.y);
  await pointer(handle, "pointerup", to.x, to.y);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0][0].contours[0].lead).toBeCloseTo(5, 5);
  const next = host.querySelector('[data-entry-handle="0"]')!;
  await pointer(next, "pointerdown", 30, 30);
  await pointer(next, "pointermove", 70, 50);
  await pointer(next, "pointercancel", 70, 50);
  expect(commit).toHaveBeenCalledTimes(1);
});

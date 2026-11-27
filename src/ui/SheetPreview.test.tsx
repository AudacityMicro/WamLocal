// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SheetPreview } from "./SheetPreview";
import { newJob } from "../core/job";
import { makePart, rectangle } from "../core/model";

let host: HTMLDivElement, root: Root;
const transform = vi.fn();
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
  transform.mockClear();
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function fixture() {
  const job = newJob();
  job.parts = [0, 1, 2].map((i) => ({
    ...makePart("Part " + i, [rectangle(20, 20)], 0, 0),
    materialId: job.materials[0].id,
    quantity: 1,
  }));
  job.sheets[0].placements = job.parts.map((p, i) => ({
    id: "p" + i,
    partId: p.id,
    x: 10 + i * 30,
    y: 10,
    rotation: 0,
    scale: 1,
  }));
  function Harness() {
    const [ids, select] = useState<string[]>([]);
    return (
      <SheetPreview
        job={job}
        sheet={job.sheets[0]}
        selectedId={ids.at(-1) ?? null}
        selectedIds={ids}
        controlsId={null}
        showLabels
        showPaths={false}
        onSelectMany={(_, ids) => select(ids)}
        onSelect={(_, id) => select(id ? [id] : [])}
        onTransformMany={transform}
        onTransform={vi.fn()}
        onControls={vi.fn()}
        onShowPaths={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onNest={vi.fn()}
        onPost={vi.fn()}
      />
    );
  }
  await act(() => root.render(<Harness />));
  return host.querySelector("svg.sheet-preview-svg")!;
}
async function pointer(
  el: Element,
  type: string,
  x: number,
  y: number,
  ctrlKey = false,
) {
  await act(() =>
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: 1,
        ctrlKey,
      }),
    ),
  );
}
const selected = () =>
  [...host.querySelectorAll('[data-placement-id] path[stroke="#f5b174"]')].map(
    (e) => e.parentElement!.getAttribute("data-placement-id"),
  );
describe("sheet selection gestures", () => {
  it("toggles Ctrl-click and selects every part with Ctrl+A", async () => {
    const svg = await fixture(),
      parts = host.querySelectorAll("[data-placement-id]");
    await pointer(parts[0], "pointerdown", 15, 15);
    await pointer(svg, "pointerup", 15, 15);
    await pointer(parts[1], "pointerdown", 45, 15, true);
    expect(selected()).toEqual(["p0", "p1"]);
    await pointer(parts[0], "pointerdown", 15, 15, true);
    expect(selected()).toEqual(["p1"]);
    await act(() =>
      svg.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(selected()).toEqual(["p0", "p1", "p2"]);
  });
  it("shows orange enclosure and green crossing boxes, with additive Ctrl-box selection", async () => {
    const svg = await fixture();
    await pointer(svg, "pointerdown", 5, 5);
    await pointer(svg, "pointermove", 45, 35);
    expect(
      host
        .querySelector('[data-selection-mode="window"]')
        ?.getAttribute("fill"),
    ).toBe("#f39a382e");
    await pointer(svg, "pointerup", 45, 35);
    expect(selected()).toEqual(["p0"]);
    await pointer(svg, "pointerdown", 75, 15, true);
    await pointer(svg, "pointermove", 65, 25, true);
    expect(
      host
        .querySelector('[data-selection-mode="crossing"]')
        ?.getAttribute("fill"),
    ).toBe("#52c4872e");
    await pointer(svg, "pointerup", 65, 25, true);
    expect(selected()).toEqual(["p0", "p2"]);
    expect(host.querySelector('[data-layer="selection-box"]')).toBeNull();
  });
  it("moves a group in one commit with unchanged relative spacing and cancels cleanly", async () => {
    const svg = await fixture();
    await act(() =>
      svg.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    );
    await pointer(
      host.querySelector('[data-placement-id="p0"]')!,
      "pointerdown",
      15,
      15,
    );
    await pointer(svg, "pointermove", 25, 20);
    await pointer(svg, "pointerup", 25, 20);
    expect(transform).toHaveBeenCalledTimes(1);
    expect(transform.mock.calls[0][1]).toEqual(
      [0, 1, 2].map((i) => ({
        id: "p" + i,
        change: { x: 20 + i * 30, y: 15 },
      })),
    );
    await pointer(svg, "pointerdown", 0, 0);
    await pointer(svg, "pointermove", 100, 100);
    await pointer(svg, "pointercancel", 100, 100);
    expect(host.querySelector('[data-layer="selection-box"]')).toBeNull();
    expect(transform).toHaveBeenCalledTimes(1);
  });
});

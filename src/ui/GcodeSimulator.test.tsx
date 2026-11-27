// @vitest-environment happy-dom
import { it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GcodeSimulator } from "./GcodeSimulator";
import { newJob } from "../core/job";
import { makePart, rectangle } from "../core/model";
import { placeDefinition } from "../core/job-ops";
it("zooms the simulation under the cursor without resetting playback and resets to fit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "DOMPoint",
    class {
      constructor(
        public x = 0,
        public y = 0,
      ) {}
      matrixTransform() {
        return this;
      }
    },
  );
  let job = newJob();
  job.tabRules!.count = 0;
  job.parts = [
    {
      ...makePart("Plate", [rectangle(20, 10)]),
      materialId: job.materials[0].id,
      quantity: 1,
    },
  ];
  job = placeDefinition(job, job.parts[0].id, job.sheets[0].id);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <GcodeSimulator job={job} sheet={job.sheets[0]} onClose={() => {}} />,
      ),
    );
    const svg = document.querySelector<SVGSVGElement>(
      '[aria-label="G-code simulation preview"]',
    )!;
    Object.defineProperty(svg, "getScreenCTM", {
      value: () => ({ inverse: () => ({}) }),
    });
    const before = svg.getAttribute("viewBox")!.split(" ").map(Number),
      progress = document.querySelector<HTMLInputElement>(
        '[aria-label="Simulation progress"]',
      )!.value;
    await act(() => {
      for (let i = 0; i < 3; i++) {
        const e = new WheelEvent("wheel", {
          deltaY: -100,
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperties(e, {
          clientX: { value: 40 },
          clientY: { value: 30 },
        });
        svg.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true);
      }
    });
    const after = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(after[2]).toBeLessThan(before[2]);
    expect(after[2]).toBeCloseTo(before[2] / 1.1 ** 3, 8);
    expect((40 - before[0]) / before[2]).toBeCloseTo(
      (40 - after[0]) / after[2],
      10,
    );
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="Simulation progress"]',
      )!.value,
    ).toBe(progress);
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (b) => b.textContent === "Pause",
      ),
    ).toBe(true);
    await act(() =>
      Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent === "Reset zoom")!
        .click(),
    );
    expect(svg.getAttribute("viewBox")!.split(" ").map(Number)).toEqual(before);
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

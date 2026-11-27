// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, expect, vi } from "vitest";
import App from "./App";
import { initialMaterialLibrary } from "../core/material-library";
let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  host?.remove();
  delete window.materialDatabase;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() =>
    root!.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
it("saves presets explicitly after committing an inline calculator edit and reports failures", async () => {
  const library = initialMaterialLibrary(),
    save = vi.fn(async (_value: unknown) => {});
  window.materialDatabase = { load: vi.fn(async () => library), save };
  await mount();
  await act(async () =>
    Array.from(host!.querySelectorAll("button"))
      .find((b) => b.textContent === "Presets")!
      .click(),
  );
  const feed = host!.querySelector<HTMLInputElement>(
    '[aria-label="Cut feed · mm/min"]',
  )!;
  await act(async () => feed.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(feed, "1in/s");
    feed.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const button = Array.from(host!.querySelectorAll("button")).find(
    (b) => b.textContent === "Save presets",
  )!;
  await act(async () => button.focus());
  await act(async () => button.click());
  expect(save).toHaveBeenCalled();
  const latest = save.mock.calls.at(-1)![0] as unknown as typeof library;
  expect(latest.materials.some((m) => m.feed === 1524)).toBe(true);
  expect(host!.textContent).toContain("Presets saved");
  save.mockRejectedValueOnce(Error("Disk is full"));
  await act(async () => button.click());
  expect(host!.textContent).toContain("Could not save presets: Disk is full");
});
it("loads desktop presets once, ignores a stale browser mirror and does not rewrite the database during startup", async () => {
  const library = initialMaterialLibrary();
  library.defaultMachine = "pro";
  library.displayUnits = "in";
  localStorage.setItem("wam-material-library", "stale invalid browser data");
  let resolve!: (value: unknown) => void;
  const load = vi.fn(() => new Promise<unknown>((r) => (resolve = r))),
    save = vi.fn(async () => {});
  window.materialDatabase = { load, save };
  const get = vi.spyOn(Storage.prototype, "getItem"),
    set = vi.spyOn(Storage.prototype, "setItem");
  await mount();
  expect(load).toHaveBeenCalledTimes(1);
  expect(host!.querySelector("[role=status]")!.textContent).toContain(
    "Opening",
  );
  expect(host!.querySelector(".job-actions")).toBeNull();
  await act(async () => resolve(library));
  expect(host!.querySelector('[aria-label="Job name"]')).not.toBeNull();
  expect(host!.textContent).toContain("WAZER");
  expect(host!.textContent).toContain("Pro");
  expect(
    (host!.querySelector('[aria-label="Job name"]') as HTMLTextAreaElement)
      .value,
  ).toMatch(/ in$/);
  expect(get.mock.calls.some(([key]) => key === "wam-material-library")).toBe(
    false,
  );
  expect(set).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  const machine = Array.from(host!.querySelectorAll("button")).find(
    (b) => b.textContent === "Machine",
  )!;
  await act(() => machine.click());
  const input = host!.querySelector<HTMLInputElement>(
    '[aria-label="Machine kerf width"]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "0.04");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
  });
  expect(save).toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});
it("protects a failed database load from automatic writes and permits retry", async () => {
  const load = vi
      .fn()
      .mockRejectedValueOnce(Error("Cannot read presets"))
      .mockResolvedValue(initialMaterialLibrary()),
    save = vi.fn(async () => {});
  window.materialDatabase = { load, save };
  await mount();
  expect(host!.querySelector("[role=alert]")!.textContent).toContain(
    "Cannot read presets",
  );
  expect(save).not.toHaveBeenCalled();
  await act(() => host!.querySelector("button")!.click());
  expect(load).toHaveBeenCalledTimes(2);
  expect(host!.querySelector(".job-actions")).not.toBeNull();
  expect(save).not.toHaveBeenCalled();
});
it("supports mouse-wheel detail zoom past the former limit without scrolling the page", async () => {
  await mount();
  await act(() =>
    Array.from(host!.querySelectorAll("button"))
      .find((b) => b.textContent === "New part")!
      .click(),
  );
  const svg = host!.querySelector<SVGSVGElement>("svg.bed")!;
  expect(svg).not.toBeNull();
  Object.defineProperty(svg, "getScreenCTM", {
    value: () => ({ inverse: () => ({}) }),
  });
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
  for (let i = 0; i < 60; i++)
    await act(() => {
      const e = new WheelEvent("wheel", {
        deltaY: -100,
        clientX: 50,
        clientY: 50,
        cancelable: true,
        bubbles: true,
      });
      Object.defineProperties(e, {
        clientX: { value: 50 },
        clientY: { value: 50 },
      });
      svg.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });
  const width = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
  expect(width).toBeLessThan(10);
});

// @vitest-environment happy-dom
import { afterEach, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import { newJob } from "../core/job";
import { makePart, rectangle } from "../core/model";
let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  host?.remove();
  delete window.jobFiles;
  delete window.mcpSetup;
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function inputText(
  input: HTMLInputElement | HTMLTextAreaElement,
  text: string,
) {
  await act(() => input.focus());
  await act(() => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function selectValue(selector: string, value: string) {
  await act(() => {
    const el = host!.querySelector<HTMLSelectElement>(selector)!;
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function click(selector: string) {
  await act(() => host!.querySelector<HTMLButtonElement>(selector)!.click());
}
async function freshApp() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() => root!.render(<App />));
}
it("starts with 6061 and an automatic name, moves actions into the sidebar, and creates/edits materials inline", async () => {
  await freshApp();
  expect(
    host!.querySelector<HTMLSelectElement>('select[aria-label="Material job"]')!
      .value,
  ).toBe("Aluminum - 6061");
  expect(host!.querySelector(".job-actions")!.textContent).toContain(
    "Upload parts",
  );
  expect(host!.textContent).not.toContain("Save current layout");
  expect(host!.querySelector(".setup-heading .button-row")).toBeNull();
  let name = host!.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Job name"]',
  )!;
  expect(name.value).toMatch(/^\d{4}-\d{2}-\d{2} · Aluminum 6061 · 3 mm$/);
  await selectValue('select[aria-label="Thickness job"]', "1.6000");
  expect(name.value).toContain("1.6 mm");
  await inputText(name, "Customer order 42");
  await act(() => name.blur());
  await selectValue('select[aria-label="Thickness job"]', "0.5080");
  expect(name.value).toBe("Customer order 42");
  await click('button[aria-label="Use automatic job name"]');
  expect(name.value).toContain("0.508 mm");
  await click('button[aria-label="New material from job"]');
  await inputText(
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Material preset name"]',
    )!,
    "Aluminum - 6063",
  );
  for (const [q, feed] of [
    ["coarse", "210"],
    ["medium", "180"],
    ["fine", "150"],
  ])
    await inputText(
      document.querySelector<HTMLInputElement>(
        `input[aria-label="${q} material feed"]`,
      )!,
      feed,
    );
  await act(() =>
    document
      .querySelector<HTMLButtonElement>(".job-material-dialog footer button")!
      .click(),
  );
  expect(document.querySelector(".job-material-dialog")).toBeNull();
  let materials = JSON.parse(
    localStorage.getItem("wam-material-library")!,
  ).materials.filter((m: any) => m.stockKey === "Aluminum - 6063");
  expect(materials.map((m: any) => m.feed)).toEqual([210, 180, 150]);
  expect(name.value).toContain("Aluminum 6063");
  await click('button[aria-label="Edit material from job"]');
  await inputText(
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Material cut feed"]',
    )!,
    "181.5",
  );
  await act(() =>
    document
      .querySelector<HTMLButtonElement>(".job-material-dialog footer button")!
      .click(),
  );
  materials = JSON.parse(
    localStorage.getItem("wam-material-library")!,
  ).materials.filter((m: any) => m.stockKey === "Aluminum - 6063");
  expect(materials.find((m: any) => m.quality === "medium").feed).toBe(181.5);
  expect(materials.find((m: any) => m.quality === "coarse").feed).toBe(210);
  const count = JSON.parse(localStorage.getItem("wam-material-library")!)
    .materials.length;
  await click('button[aria-label="New material from job"]');
  await inputText(
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Material preset name"]',
    )!,
    "Do not save",
  );
  await act(() =>
    document
      .querySelector<HTMLButtonElement>(".job-material-dialog header button")!
      .click(),
  );
  expect(document.querySelector(".job-material-dialog")).toBeNull();
  expect(
    JSON.parse(localStorage.getItem("wam-material-library")!).materials.length,
  ).toBe(count);
}, 15000);

it("gives Presets, Machine and MCP full-page content, and copies the generated MCP setup and sample prompt", async () => {
  const copy = vi.fn(async (_text: string) => {});
  window.mcpSetup = {
    load: async () => ({
      command: "C:/Wam Local/Wam Local.exe",
      args: ["C:/Wam Local/resources/app.asar/dist-mcp/server.mjs"],
      projectDirectory: "C:/Jobs",
      electron: true,
    }),
    copy,
  };
  await freshApp();
  async function page(label: string) {
    const button = [
      ...host!.querySelectorAll<HTMLButtonElement>(".rail button"),
    ].find((b) => b.textContent === label)!;
    await act(async () => {
      button.click();
    });
    expect(host!.querySelector("aside.inspector")).toBeNull();
  }
  await page("Presets");
  expect(
    host!.querySelector(".materials-page .materials-database"),
  ).not.toBeNull();
  await page("Machine");
  expect(host!.querySelector(".machine-settings-page")).not.toBeNull();
  await page("MCP");
  expect(host!.querySelectorAll(".mcp-tool-groups li")).toHaveLength(48);
  const configuration = JSON.parse(
    host!.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="MCP client configuration"]',
    )!.value,
  );
  expect(configuration.mcpServers["wam-local"].env.ELECTRON_RUN_AS_NODE).toBe(
    "1",
  );
  expect(configuration.mcpServers["wam-local"].env.WAM_PROJECT_DIR).toBe(
    "C:/Jobs",
  );
  const buttons = [...host!.querySelectorAll<HTMLButtonElement>("button")];
  await act(async () =>
    buttons.find((b) => b.textContent === "Copy configuration")!.click(),
  );
  expect(copy.mock.calls[0][0]).toContain('"mcpServers"');
  await act(async () =>
    buttons.find((b) => b.textContent === "Copy test prompt")!.click(),
  );
  expect(copy.mock.calls[1][0]).toContain("mcp-smoke-test.wam");
  expect(copy.mock.calls[1][0]).toContain("post_all");
});
it("edits .005-inch stock allowance in the real part panel and saves the model with draggable controls", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
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
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(Element.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ a: 1, b: 0, inverse: () => ({}) }),
  });
  const job = newJob();
  job.name = "Editing test";
  job.materials[0].requiresVerification = true;
  job.parts = [
    {
      ...makePart("Plate", [rectangle(40, 30)]),
      materialId: job.materials[0].id,
      quantity: 1,
    },
  ];
  job.sheets[0].placements = [
    {
      id: "copy",
      partId: job.parts[0].id,
      x: 30,
      y: 30,
      rotation: 0,
      scale: 1,
    },
  ];
  let command = (s: string) => {};
  const save = vi.fn(async () => ({ path: "editing.wam" }));
  window.jobFiles = {
    open: async () => ({ job, path: "editing.wam" }),
    save,
    post: vi.fn(async () => null),
    reset: async () => {},
    confirmDiscard: async () => "discard",
    updateViewPreferences: vi.fn(),
    setDirty: vi.fn(),
    close: vi.fn(),
    onCommand: (cb) => {
      command = cb;
      return () => {};
    },
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() => root!.render(<App />));
  await act(async () => command("open"));
  await act(() =>
    host!
      .querySelector<HTMLButtonElement>('button[aria-label="Edit part Plate"]')!
      .click(),
  );
  const cuts = [
    ...host.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
  ].find((b) => b.textContent === "Cuts & tabs")!;
  await act(() => cuts.click());
  await act(() => command("units-in"));
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Stock to leave"]',
  )!;
  await act(() => input.focus());
  for (const text of [".", ".0", ".00", ".005"]) {
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  expect(input.value).toBe(".005");
  await act(() => input.blur());
  expect(host.querySelectorAll("[data-tab-handle]").length).toBe(2);
  expect(host.querySelectorAll("[data-entry-handle]").length).toBe(1);
  expect(host.querySelectorAll("[data-lead-handle]").length).toBe(1);
  expect(host.textContent).not.toContain("Preview parameters");
  expect(host.querySelectorAll('.bed circle[fill="#f5b174"]')).toHaveLength(0);
  const tab = host.querySelector('[data-tab-handle="0-0"]')!,
    x = Number(tab.getAttribute("cx")),
    y = Number(tab.getAttribute("cy"));
  for (const [type, atX, atY] of [
    ["pointerdown", x, y],
    ["pointermove", x + 5, y + 5],
    ["pointerup", x + 5, y + 5],
  ] as const) {
    await act(() =>
      tab.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          button: 0,
          clientX: atX,
          clientY: atY,
        }),
      ),
    );
  }
  expect(
    host.querySelector<HTMLSelectElement>('select[data-default-key="tabMode"]')!
      .value,
  ).toBe("manual");
  await act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    ),
  );
  expect(
    host.querySelector<HTMLSelectElement>('select[data-default-key="tabMode"]')!
      .value,
  ).toBe("auto");
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="Stock to leave"]')!
      .value,
  ).toBe("0.005");
  await act(async () => command("save"));
  expect(save).toHaveBeenCalled();
  expect(
    (save.mock.calls as unknown as [any][]).at(-1)![0].parts[0].stockToLeave,
  ).toBeCloseTo(0.127, 9);
  const handle = host.querySelector<SVGElement>('[data-tab-handle="0-0"]')!;
  await act(() => handle.focus());
  await act(() =>
    handle.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Delete",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(host.querySelectorAll("[data-tab-handle]")).toHaveLength(1);
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="Part name"]'),
  ).toBeNull(); // cuts panel stays open
  await act(async () => command("save"));
  const afterDelete = (save.mock.calls as unknown as [any][]).at(-1)![0];
  expect(afterDelete.parts).toHaveLength(1);
  expect(afterDelete.parts[0].contours[0]).toMatchObject({ tabMode: "manual" });
  expect(afterDelete.parts[0].contours[0].tabs).toHaveLength(1);
  await act(() =>
    host!
      .querySelector('[data-layer="part-cut-handles"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Delete",
          bubbles: true,
          cancelable: true,
          repeat: true,
        }),
      ),
  );
  expect(host.querySelectorAll("[data-tab-handle]")).toHaveLength(1);
  await act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    ),
  );
  expect(host.querySelectorAll("[data-tab-handle]")).toHaveLength(2);
});

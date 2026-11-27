// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { newJob, jobSchema } from "../core/job";
import { makePart, rectangle } from "../core/model";
let root: Root, host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  delete window.jobFiles;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const fixture = (name: string) => {
  const j = newJob();
  return jobSchema.parse({
    ...j,
    name,
    nameMode: "manual",
    parts: [
      {
        ...makePart(name + " part", [rectangle(20, 10)]),
        materialId: j.materials[0].id,
        quantity: 1,
      },
    ],
  });
};
async function click(selector: string) {
  await act(async () =>
    host.querySelector<HTMLButtonElement>(selector)!.click(),
  );
}
async function quantity(value: string) {
  const el = host.querySelector<HTMLInputElement>('[aria-label^="Quantity "]')!;
  await act(async () => el.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => el.blur());
}
it("keeps jobs, quantities, undo histories and native save destinations independent across tabs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const a = fixture("Job A"),
    b = fixture("Job B"),
    opened = [a, b];
  let command!: (command: string) => void;
  const save = vi.fn(
    async (job: unknown, _saveAs?: boolean, docId?: string) => ({
      path: `C:/jobs/${(job as { name: string }).name}.wam`,
    }),
  );
  const confirm = vi.fn(async () => "cancel" as "save" | "discard" | "cancel");
  window.jobFiles = {
    open: vi.fn(async () => {
      const job = opened.shift()!;
      return { job, path: `C:/jobs/${job.name}.wam` };
    }),
    save,
    confirmDiscard: confirm,
    reset: vi.fn(async () => {}),
    post: vi.fn(),
    close: vi.fn(),
    onCommand: (cb) => {
      command = cb;
      return () => {};
    },
    updateViewPreferences: vi.fn(),
    setDirty: vi.fn(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<App />));
  expect(host.querySelector(".setup-empty button")!.textContent).toContain(
    "Upload parts",
  );
  const upload = host.querySelector<HTMLInputElement>(
      "input[type=file][multiple]",
    )!,
    inputClick = vi.spyOn(upload, "click");
  await click(".setup-empty button");
  expect(inputClick).toHaveBeenCalledOnce();
  await act(async () => command("open"));
  await quantity("0");
  await act(async () => command("save"));
  const aId = save.mock.calls[0][2];
  expect((save.mock.calls[0][0] as typeof a).parts[0].quantity).toBe(0);
  await act(async () => command("open"));
  await quantity("3");
  await act(async () => command("save"));
  const bId = save.mock.calls[1][2];
  expect(aId).not.toBe(bId);
  expect(host.querySelectorAll("[role=tab]")).toHaveLength(3);
  await click('[role=tab][title="C:/jobs/Job A.wam"]');
  expect(
    host.querySelector<HTMLInputElement>('[aria-label="Quantity Job A part"]')!
      .value,
  ).toBe("0");
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(
    host.querySelector<HTMLInputElement>('[aria-label="Quantity Job A part"]')!
      .value,
  ).toBe("1");
  await act(async () => command("save"));
  expect(save.mock.calls[2][2]).toBe(aId);
  await click('[role=tab][title="C:/jobs/Job B.wam"]');
  expect(
    host.querySelector<HTMLInputElement>('[aria-label="Quantity Job B part"]')!
      .value,
  ).toBe("3");
  await quantity("5");
  await click('[role=tab][title="C:/jobs/Job A.wam"]');
  await click('[aria-label="Close job Job B"]');
  expect(confirm).toHaveBeenCalledWith("Job B");
  expect(host.querySelectorAll("[role=tab]")).toHaveLength(3);
  // Closing the window protects an unsaved job even when another tab is active.
  await act(async () => command("close"));
  expect(window.jobFiles.close).not.toHaveBeenCalled();
  confirm.mockResolvedValue("discard");
  await click('[aria-label="Close job Job B"]');
  expect(host.querySelectorAll("[role=tab]")).toHaveLength(2);
  await act(async () => command("new"));
  expect(host.querySelectorAll("[role=tab]")).toHaveLength(3);
  const selected = host.querySelector("[role=tab][aria-selected=true]");
  expect(selected!.textContent).not.toContain("*");
  const jobName = host.querySelector<HTMLTextAreaElement>(
    '[aria-label="Job name"]',
  )!;
  await act(async () => jobName.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(jobName, "Pending name before tab switch");
    jobName.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(host.querySelector("[role=tab][aria-selected=true]")).not.toBe(
    selected,
  );
  await click(`[id="${selected!.id}"]`);
  expect(
    host.querySelector<HTMLTextAreaElement>('[aria-label="Job name"]')!.value,
  ).toBe("Pending name before tab switch");
});

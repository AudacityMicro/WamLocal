import { describe, it, expect, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { readJobFile, writeJobFile } from "../desktop/job-files";
import { readLibraryFile, writeLibraryFile } from "../desktop/material-library";
import { newJob } from "./job";
import { makePart, rectangle, newProject } from "./model";
const { registerJobFiles } = createRequire(import.meta.url)(
  "../../electron/job-files.cjs",
);

describe("WAM documents", () => {
  it("starts with no parts or placements", () => {
    const job = newJob();
    expect(job.parts).toEqual([]);
    expect(job.sheets.every((s) => s.placements.length === 0)).toBe(true);
  });
  it("round-trips a complete job without its original imported files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wam-document-"));
    try {
      const job = newJob();
      job.parts.push({
        ...makePart("Plate", [
          {
            ...rectangle(),
            startPosition: 0.25,
            tabMode: "manual",
            tabs: [{ position: 0.5, width: 3 }],
          },
        ]),
        quantity: 3,
        materialId: job.materials[0].id,
      });
      job.sheets[0].wcs = { x: 12, y: 20 };
      job.sheets[0].placements.push({
        id: "placement",
        partId: job.parts[0].id,
        x: 15,
        y: 25,
        rotation: 90,
        scale: 1,
      });
      job.materials[0].lead = 4;
      const file = path.join(dir, "plate.wam");
      await writeJobFile(file, job);
      expect(await readJobFile(file)).toEqual(job);
      await expect(
        writeJobFile(file, { ...job, parts: [{ name: "invalid" }] }),
      ).rejects.toThrow();
      expect(await readJobFile(file)).toEqual(job);
      await writeJobFile(file, { ...job, name: "Revised" });
      expect((await readJobFile(file)).name).toBe("Revised");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("opens old JSON projects and rejects unrelated or oversized files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wam-legacy-"));
    try {
      const file = path.join(dir, "old.wam.json");
      await writeFile(file, JSON.stringify(newProject()));
      expect((await readJobFile(file)).version).toBe(2);
      await writeFile(file, "{broken");
      await expect(readJobFile(file)).rejects.toThrow();
      await writeFile(file, " ".repeat(20_000_001));
      await expect(readJobFile(file)).rejects.toThrow("20 MB");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("keeps local presets across jobs without mutating embedded job settings", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wam-defaults-"));
    try {
      const dbFile = path.join(dir, "material-library.json");
      const library = await readLibraryFile(dbFile);
      library.materials[0].feed = 321;
      await writeLibraryFile(dbFile, library);
      const job = newJob();
      const file = path.join(dir, "saved.wam");
      await writeJobFile(file, job);
      library.materials[0].feed = 456;
      await writeLibraryFile(dbFile, library);
      expect((await readLibraryFile(dbFile)).materials[0].feed).toBe(456);
      expect(await readJobFile(file)).toEqual(job);
      expect((await readJobFile(file)).materials[0].feed).toBe(
        job.materials[0].feed,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function harness() {
  const handlers = new Map<string, Function>();
  const frame = {};
  const win = Object.assign(new EventEmitter(), {
    webContents: { mainFrame: frame, send: vi.fn() },
    close: vi.fn(),
  });
  const event = { sender: win.webContents, senderFrame: frame };
  const dialog = {
    showSaveDialog: vi.fn(async () => ({
      canceled: false,
      filePath: "C:/jobs/plate.wam",
    })),
    showOpenDialog: vi.fn(async () => ({
      canceled: false,
      filePaths: ["C:/jobs/opened.wam"],
    })),
    showMessageBox: vi.fn(async () => ({ response: 2 })),
  };
  const read = vi.fn(async () => newJob());
  const write = vi.fn(async () => {});
  const command = registerJobFiles({
    ipcMain: {
      handle: (key: string, fn: Function) => handlers.set(key, fn),
      on: (key: string, fn: Function) => handlers.set(key, fn),
    },
    dialog,
    win,
    readJobFile: read,
    writeJobFile: write,
  });
  return {
    handlers,
    event,
    dialog,
    win,
    read,
    write,
    command,
    call: (key: string, ...args: unknown[]) =>
      handlers.get(key)!(event, ...args),
  };
}
describe("native document lifecycle", () => {
  it("Save picks a path once, overwrites on the next save, and Save As picks again", async () => {
    const h = harness(),
      job = newJob();
    await h.call("wam:job-save", job, false);
    await h.call("wam:job-save", job, false);
    expect(h.dialog.showSaveDialog).toHaveBeenCalledTimes(1);
    expect(h.write).toHaveBeenLastCalledWith("C:/jobs/plate.wam", job);
    await h.call("wam:job-save", job, true);
    expect(h.dialog.showSaveDialog).toHaveBeenCalledTimes(2);
    await h.call("wam:job-reset");
    await h.call("wam:job-save", job, false);
    expect(h.dialog.showSaveDialog).toHaveBeenCalledTimes(3);
  });
  it("canceled and failed Save As preserve the current document path", async () => {
    const h = harness(),
      job = newJob();
    await h.call("wam:job-save", job, false);
    h.dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: true,
      filePath: "",
    });
    expect(await h.call("wam:job-save", job, true)).toBeNull();
    h.dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: "C:/jobs/failed.wam",
    });
    h.write.mockRejectedValueOnce(Error("disk full"));
    await expect(h.call("wam:job-save", job, true)).rejects.toThrow(
      "disk full",
    );
    await h.call("wam:job-save", job, false);
    expect(h.write).toHaveBeenLastCalledWith("C:/jobs/plate.wam", job);
  });
  it("Open validates before adopting a path and Save uses the opened path", async () => {
    const h = harness(),
      job = newJob();
    await h.call("wam:job-save", job, false);
    h.read.mockRejectedValueOnce(Error("invalid job"));
    await expect(h.call("wam:job-open")).rejects.toThrow("invalid job");
    await h.call("wam:job-save", job, false);
    expect(h.write).toHaveBeenLastCalledWith("C:/jobs/plate.wam", job);
    const opened = await h.call("wam:job-open");
    expect(opened.path).toBe("C:/jobs/opened.wam");
    await h.call("wam:job-save", job, false);
    expect(h.write).toHaveBeenLastCalledWith("C:/jobs/opened.wam", job);
  });
  it("blocks close for unsaved work until the renderer confirms, and rejects untrusted frames", () => {
    const h = harness();
    h.call("wam:job-dirty", true);
    const event = { preventDefault: vi.fn() };
    h.win.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(h.win.webContents.send).toHaveBeenCalledWith(
      "wam:file-command",
      "close",
    );
    expect(() =>
      h.handlers.get("wam:job-reset")!({ sender: {}, senderFrame: {} }),
    ).toThrow("rejected");
    h.call("wam:job-close");
    expect(h.win.close).toHaveBeenCalledOnce();
  });
});

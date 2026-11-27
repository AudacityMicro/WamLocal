import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { jobFilename } from "../core/cut-filename";
const { registerJobFiles } = createRequire(import.meta.url)(
  "../../electron/job-files.cjs",
);
it("routes alternating saves to each tab path and protects hidden unsaved tabs", async () => {
  const handles = new Map<string, Function>(),
    listeners = new Map<string, Function>(),
    windowEvents = new Map<string, Function>();
  const frame = {},
    webContents = { mainFrame: frame, send: vi.fn() },
    event = { sender: webContents, senderFrame: frame };
  const dialog = {
    showOpenDialog: vi
      .fn()
      .mockResolvedValueOnce({ filePaths: ["C:/jobs/a.wam"] })
      .mockResolvedValueOnce({ filePaths: ["C:/jobs/b.wam"] }),
    showSaveDialog: vi
      .fn()
      .mockResolvedValue({ filePath: "C:/jobs/b-copy.wam" }),
    showMessageBox: vi.fn().mockResolvedValue({ response: 2 }),
  };
  const write = vi.fn(async (_file: string, _job: unknown) => {}),
    win = {
      webContents,
      on: (name: string, cb: Function) => windowEvents.set(name, cb),
      close: vi.fn(),
    };
  registerJobFiles({
    ipcMain: {
      handle: (name: string, cb: Function) => handles.set(name, cb),
      on: (name: string, cb: Function) => listeners.set(name, cb),
    },
    dialog,
    win,
    jobFilename,
    readJobFile: async (file: string) => ({ name: file }),
    writeJobFile: write,
  });
  await handles.get("wam:job-open")!(event, "a");
  await handles.get("wam:job-open")!(event, "b");
  await handles.get("wam:job-save")!(event, { name: "A" }, false, "a");
  await handles.get("wam:job-save")!(event, { name: "B" }, false, "b");
  await handles.get("wam:job-save")!(event, { name: "A again" }, false, "a");
  expect(write.mock.calls.map((c: unknown[]) => c[0])).toEqual([
    "C:/jobs/a.wam",
    "C:/jobs/b.wam",
    "C:/jobs/a.wam",
  ]);
  expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  await handles.get("wam:job-save")!(event, { name: "B copy" }, true, "b");
  await handles.get("wam:job-save")!(
    event,
    { name: "A after save as" },
    false,
    "a",
  );
  expect(write.mock.calls.at(-1)![0]).toBe("C:/jobs/a.wam");
  listeners.get("wam:job-dirty")!(event, true);
  const preventDefault = vi.fn();
  windowEvents.get("close")!({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(webContents.send).toHaveBeenCalledWith("wam:file-command", "close");
  await handles.get("wam:job-reset")!(event, "b");
  expect(() =>
    handles.get("wam:job-save")!({ ...event, senderFrame: {} }, {}, false, "a"),
  ).toThrow("rejected");
});
it("replaces internal periods on a chosen save name and presents the normalized target for overwrite confirmation", async () => {
  const handles = new Map<string, Function>(),
    frame = {},
    webContents = { mainFrame: frame };
  const dialog = {
    showSaveDialog: vi
      .fn()
      .mockResolvedValueOnce({ filePath: "C:/jobs/Plate.0.020.wam" })
      .mockResolvedValueOnce({ filePath: "C:/jobs/Plate_0_020.wam" }),
  };
  const write = vi.fn(async (_file: string, _job: unknown) => {});
  registerJobFiles({
    ipcMain: {
      handle: (n: string, cb: Function) => handles.set(n, cb),
      on: () => {},
    },
    dialog,
    win: { webContents, on: () => {} },
    jobFilename,
    readJobFile: vi.fn(),
    writeJobFile: write,
  });
  const result = await handles.get("wam:job-save")!(
    { sender: webContents, senderFrame: frame },
    { name: "Plate.0.020" },
    false,
    "a",
  );
  expect(result.path).toMatch(/Plate_0_020\.wam$/);
  expect(write).toHaveBeenCalledOnce();
  expect(dialog.showSaveDialog).toHaveBeenCalledTimes(2);
});

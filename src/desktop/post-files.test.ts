import { describe, it, expect, vi } from "vitest";
import * as fileSystem from "node:fs/promises";
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { writePostedFiles } from "./post-files";
import { postJob } from "../core/postprocessor";
import { cutFilename } from "../core/cut-filename";
import { newJob } from "../core/job";
import { rectangle, makePart } from "../core/model";
const require = createRequire(import.meta.url);
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const { registerPosting } = require("../../electron/posting.cjs");
async function temporary(work: (folder: string) => Promise<void>) {
  const folder = await mkdtemp(path.join(tmpdir(), "wam-post-"));
  try {
    await work(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
describe("cut file output", () => {
  it("rolls back the entire batch if a later replacement fails", async () =>
    temporary(async (folder) => {
      const files = [
        { filename: "JAA001.gcode", content: "old first" },
        { filename: "JAA002.gcode", content: "old second" },
      ];
      await writePostedFiles(folder, files);
      const realRename = (
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        )
      ).rename;
      const failure = vi
        .mocked(fileSystem.rename)
        .mockImplementation(async (from, to) => {
          if (
            String(from).includes(".tmp-") &&
            String(to).endsWith("JAA002.gcode")
          )
            throw Error("Simulated SD write failure");
          return realRename(from, to);
        });
      try {
        await expect(
          writePostedFiles(
            folder,
            files.map((f) => ({ ...f, content: "new" })),
            true,
          ),
        ).rejects.toThrow(/SD write failure/);
        for (const f of files)
          expect(await readFile(path.join(folder, f.filename), "utf8")).toBe(
            f.content,
          );
        expect((await readdir(folder)).sort()).toEqual(
          files.map((f) => f.filename),
        );
      } finally {
        failure.mockRestore();
      }
    }));
  it("writes a complete batch, detects collisions before writing, and replaces only with authorization", async () =>
    temporary(async (folder) => {
      const files = [
        { filename: "JAA001.gcode", content: "first" },
        { filename: "JAA002.gcode", content: "second" },
      ];
      await writePostedFiles(folder, files);
      expect(await readFile(path.join(folder, files[0].filename), "utf8")).toBe(
        "first",
      );
      await expect(
        writePostedFiles(folder, [
          ...files,
          { filename: "JAA003.gcode", content: "new" },
        ]),
      ).rejects.toThrow(/replace/);
      expect(await readdir(folder)).toHaveLength(2);
      await writePostedFiles(
        folder,
        files.map((f) => ({ ...f, content: "updated" })),
        true,
      );
      expect(await readFile(path.join(folder, files[1].filename), "utf8")).toBe(
        "updated",
      );
      expect((await readdir(folder)).some((f) => /tmp-|bak-/.test(f))).toBe(
        false,
      );
    }));
  it("rejects traversal, duplicate names, directories and oversized output without changing existing files", async () =>
    temporary(async (folder) => {
      await writeFile(path.join(folder, "JAA001.gcode"), "original");
      await mkdir(path.join(folder, "JAA002.gcode"));
      await expect(
        writePostedFiles(folder, [{ filename: "../out.gcode", content: "x" }]),
      ).rejects.toThrow(/filenames/);
      await expect(
        writePostedFiles(folder, [{ filename: "CON.gcode", content: "x" }]),
      ).rejects.toThrow(/filenames/);
      await expect(
        writePostedFiles(
          folder,
          [
            { filename: "JAA001.gcode", content: "new" },
            { filename: "JAA002.gcode", content: "new" },
          ],
          true,
        ),
      ).rejects.toThrow(/replace/);
      await expect(
        writePostedFiles(folder, [
          { filename: "JAA003.gcode", content: "a" },
          { filename: "jaa003.gcode", content: "b" },
        ]),
      ).rejects.toThrow(/duplicate/);
      expect(await readFile(path.join(folder, "JAA001.gcode"), "utf8")).toBe(
        "original",
      );
    }));
  it("routes native sheet/all posting through the real compiler and writer, and rejects foreign senders", async () =>
    temporary(async (folder) => {
      const job = newJob("pro");
      job.materials[0] = {
        ...job.materials[0],
        lead: 2,
        tabCount: 2,
        requiresVerification: false,
      };
      job.parts = [
        {
          ...makePart("square", [rectangle(30, 20)]),
          materialId: job.materials[0].id,
          quantity: 1,
        },
      ];
      const sheet = job.sheets[0];
      sheet.placements = [
        {
          id: "copy",
          partId: job.parts[0].id,
          x: 20,
          y: 20,
          scale: 1,
          rotation: 0,
        },
      ];
      let handler: any;
      const win = { webContents: { mainFrame: {} } };
      const dialog = {
        showSaveDialog: async () => ({
          filePath: path.join(folder, "TEST.gcode"),
          canceled: false,
        }),
        showOpenDialog: async () => ({ filePaths: [folder], canceled: false }),
        showMessageBox: async () => ({ response: 0 }),
      };
      registerPosting({
        cutFilename,
        ipcMain: {
          handle: (_: string, callback: any) => {
            handler = callback;
          },
        },
        dialog,
        win,
        postJob,
        writePostedFiles,
      });
      const event = {
        sender: win.webContents,
        senderFrame: win.webContents.mainFrame,
      };
      await expect(
        handler({ ...event, senderFrame: {} }, job, sheet.id),
      ).rejects.toThrow(/rejected/);
      const single = await handler(event, job, sheet.id);
      expect(single.paths).toEqual([path.join(folder, "TEST.gcode")]);
      expect(await readFile(single.paths[0], "utf8")).toContain("M1404");
      const all = await handler(event, job);
      expect(await readFile(all.paths[0], "utf8")).toBe(
        postJob(job)[0].content,
      );
      dialog.showSaveDialog=async()=>({filePath:path.join(folder,'shim.0.020.gcode'),canceled:false});
      const renamed=await handler(event,job,sheet.id);
      expect(path.basename(renamed.paths[0])).toBe('shim_0_020.gcode');
      dialog.showMessageBox=async()=>({response:1});
      expect(await handler(event,job,sheet.id)).toBeNull();
      dialog.showMessageBox=async()=>({response:0});
      dialog.showSaveDialog = async () => ({ filePath: "", canceled: true });
      expect(await handler(event, job, sheet.id)).toBeNull();
      job.materials[0].requiresVerification = true;
      const flagged = await handler(event, job);
      expect(flagged.paths).toEqual(all.paths);
      expect(await readFile(flagged.paths[0], "utf8")).toBe(
        postJob(job)[0].content,
      );
    }));
});

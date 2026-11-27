import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { partSchema } from "../core/model";
import type { ImportSettings } from "../core/import-settings";
export async function importDrawing(input: {
  name: string;
  data: string;
  sourcePath?: string;
  stepFaceId?: string;
  unit: "mm" | "in";
  settings: ImportSettings;
}) {
  const require = createRequire(import.meta.url);
  const electron = process.versions.electron
    ? process.execPath
    : (require("electron") as string);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.resolve(
    here,
    here.endsWith(`${path.sep}mcp`)
      ? "../../electron/mcp-import.cjs"
      : "../electron/mcp-import.cjs",
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const folder = await mkdtemp(path.join(tmpdir(), "wam-cam-import-")),
    requestFile = path.join(folder, "request.json");
  try {
    await writeFile(requestFile, JSON.stringify(input), "utf8");
    return await new Promise<{
      part: ReturnType<typeof partSchema.parse>;
      notices: string[];
    }>((resolve, reject) => {
      const child = spawn(
        electron,
        process.versions.electron
          ? ["--wam-cam-import", requestFile]
          : [script, requestFile],
        {
          env,
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let errors = "",
        settled = false;
      const finish = async (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) {
          child.kill();
          reject(error);
          return;
        }
        try {
          if ((await stat(requestFile + ".result")).size > 40000000)
            throw Error("Converted drawing exceeds 40 MB.");
          const data = JSON.parse(
            await readFile(requestFile + ".result", "utf8"),
          );
          if (data.error) throw Error(data.error);
          resolve({
            part: partSchema.parse(data.part),
            notices: data.notices ?? [],
          });
        } catch (e) {
          reject(e);
        }
      };
      const timeout = setTimeout(
        () => finish(Error("Drawing conversion exceeded 150 seconds.")),
        150000,
      );
      child.stderr.on("data", (chunk) => {
        errors = (errors + chunk).slice(-4000);
      });
      child.on("error", finish);
      child.on("close", (code) =>
        finish(
          code ? Error(`Drawing conversion failed: ${errors}`) : undefined,
        ),
      );
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

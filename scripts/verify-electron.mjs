import { _electron as electron } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = await mkdtemp(path.join(tmpdir(), "wam-electron-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
  ),
);
const executablePath = path.resolve(
  process.env.WAM_ELECTRON_EXE || "node_modules/electron/dist/electron.exe",
);
const args = process.env.WAM_ELECTRON_EXE ? [] : ["."];
await access(executablePath);
let app, client;
try {
  app = await electron.launch({
    executablePath,
    args,
    env: { ...env, WAM_USER_DATA_DIR: path.join(root, "editor") },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.getByRole("heading", { name: "Design & arrange" }).waitFor();
  assert.equal(await page.locator(".parts-table button").count(), 4);
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("Electron console:", msg.text());
  });
  await page.context().setOffline(true);
  await page
    .locator('input[type=file][accept=".svg,.dxf"]')
    .setInputFiles({
      name: "offline.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="20mm" viewBox="0 0 30 20"><rect width="30" height="20"/></svg>',
      ),
    });
  await page.getByRole("status").waitFor();
  console.log("Electron SVG:", await page.getByRole("status").innerText());
  assert.equal(await page.locator(".parts-table button").count(), 5);
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("https://example.com");
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  assert.deepEqual(errors, []);
  await app.close();
  app = null;
  client = new Client({ name: "electron-mcp-verification", version: "1.0.0" });
  const serverPath = process.env.WAM_ELECTRON_EXE
    ? path.join(
        path.dirname(executablePath),
        "resources/app.asar/dist-mcp/server.mjs",
      )
    : path.resolve("dist-mcp/server.mjs");
  const transport = new StdioClientTransport({
    command: executablePath,
    args: [serverPath],
    stderr: "pipe",
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      WAM_PROJECT_DIR: path.join(root, "projects"),
    },
  });
  transport.stderr?.on("data", (d) => console.log("MCP stderr:", d.toString()));
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some(t=>t.name==='nest_job'));
  const r = await client.callTool({
    name: "create_project",
    arguments: {
      file: "test.wam.json",
      name: "Electron MCP",
      machine: "desktop",
    },
  });
  assert.ok(!r.isError, JSON.stringify(r));
  console.log(
    "Electron verified: local file startup, sandboxed renderer, SVG import with network offline, blocked outbound fetch, bundled MCP stdio tools and project creation.",
  );
} finally {
  if (client) await client.close();
  if (app) await app.close();
  await rm(root, { recursive: true, force: true });
}

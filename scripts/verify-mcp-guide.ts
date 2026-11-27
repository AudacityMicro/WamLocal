import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { MCP_TOOL_GROUPS, mcpTestPrompt } from "../src/ui/mcp-guide";
const root = await mkdtemp(path.join(tmpdir(), "wam-guide-")),
  results = [];
try {
  for (const machine of ["desktop", "pro"] as const) {
    const folder = path.join(root, machine);
    await mkdir(folder);
    const exe = process.env.WAM_MCP_EXE;
    const client = new Client({ name: "wam-guide-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: exe ?? process.execPath,
        args: exe
          ? [
              path.join(
                path.dirname(exe),
                "resources/app.asar/dist-mcp/server.mjs",
              ),
            ]
          : ["node_modules/tsx/dist/cli.mjs", "src/mcp/server.ts"],
        env: {
          ...process.env,
          ...(exe ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          WAM_PROJECT_DIR: folder,
          WAM_MATERIAL_LIBRARY: path.join(folder, "materials.json"),
        },
      }),
    );
    try {
      assert.ok(client.getInstructions()?.includes("Prefer version-2 .wam jobs"));
      const actual = (await client.listTools()).tools.map((t) => t.name).sort();
      assert.deepEqual(
        [...MCP_TOOL_GROUPS.flatMap((g) => [...g.tools])].sort(),
        actual,
      );
      const call = async (name: string, args: any) => {
        const r = await client.callTool({ name, arguments: args });
        assert.ok(!r.isError, JSON.stringify(r));
        return JSON.parse((r.content[0] as any).text);
      };
      const auto=await call("create_job",{file:"automatic-name.wam",machine});
      assert.equal(auto.nameMode,"auto");assert.match(auto.name,/Aluminum 6061/);
      const file = "mcp-smoke-test.wam";
      let job = await call("create_job", {
        file,
        name: "ZZ MCP Smoke Test",
        machine,
      });
      let material = job.materials.find(
        (m: any) => m.id === job.sheets[0].materialId,
      );
      const library = await call("read_material_library", {});
      const selected = library.materials.find(
        (m: any) =>
          m.machine === machine &&
          m.stockKey === "Aluminum - 6061" &&
          m.quality === "medium" &&
          Math.abs(m.thickness - 3) < 0.0001,
      );
      assert.ok(selected);
      job.materials = [selected];
      job.sheets[0].materialId = selected.id;
      material = selected;
      assert.equal(material.stockKey, "Aluminum - 6061");
      assert.equal(material.quality, "medium");
      assert.equal(material.machine, machine);
      job.sheets[0].stock = { width: 150, height: 100, margin: 5, spacing: 3 };
      job.sheets[0].workOrigin = "top-left";
      job.tabRules.count = 0;
      job = await call("write_job", { file, job });
      const rectangle = (w: number, h: number) => ({
        closed: true,
        hole: false,
        points: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ],
      });
      const hole = {
        closed: true,
        hole: true,
        points: Array.from({ length: 128 }, (_, i) => ({
          x: 20 + 4 * Math.cos((i * Math.PI) / 64),
          y: 12.5 + 4 * Math.sin((i * Math.PI) / 64),
        })),
      };
      for (const [id, name, quantity, contours] of [
        ["plate", "Plate", 3, [rectangle(40, 25), hole]],
        ["bracket", "Bracket", 2, [rectangle(30, 20)]],
      ] as const) {
        job = await call("add_job_part", {
          file,
          part: {
            id,
            name,
            quantity,
            contours,
            materialId: material.id,
            x: 0,
            y: 0,
            rotation: 0,
            scale: 1,
            cut: "outside",
          },
        });
      }
      const nested = await call("nest_job", {
        file,
        settings: {
          method: "bounds",
          effort: "fast",
          rotationStep: 90,
          budgetSeconds: 5,
          budgetMode: "fixed",
        },
      });
      assert.equal(
        nested.sheets.reduce((n: number, s: any) => n + s.placements.length, 0),
        5,
      );
      const inspected = await call("inspect_job", { file });
      assert.equal(
        inspected.sheets.filter((s: any) => s.operations.length).length,
        1,
      );
      const posted = await call("post_all", { file, replace: false });
      assert.equal(posted.paths.length, 1);
      assert.equal(posted.sheets[0].operations, 8);
      const read = await call("read_job", { file });
      assert.equal(read.name, "ZZ MCP Smoke Test");
      results.push({
        machine,
        tools: actual.length,
        copies: 5,
        files: posted.paths.length,
        operations: posted.sheets[0].operations,
        preflightIssues: inspected.issues,
        promptIncludesMachine: mcpTestPrompt(machine).includes(
          machine === "pro" ? "WAZER Pro" : "WAZER Desktop",
        ),
      });
    } finally {
      await client.close();
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
await writeFile(
  "artifacts/mcp-guide-verification.json",
  JSON.stringify({ packaged: !!process.env.WAM_MCP_EXE, results }, null, 2),
);
console.log(JSON.stringify(results, null, 2));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = await mkdtemp(path.join(tmpdir(), "wam-mcp-test-"));
const transport = new StdioClientTransport({
  command: process.env.WAM_MCP_EXE || process.execPath,
  args: process.env.WAM_MCP_EXE
    ? [
        path.join(
          path.dirname(process.env.WAM_MCP_EXE),
          "resources/app.asar/dist-mcp/server.mjs",
        ),
      ]
    : ["node_modules/tsx/dist/cli.mjs", "src/mcp/server.ts"],
  env: {
    ...process.env,
    ...(process.env.WAM_MCP_EXE ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    WAM_PROJECT_DIR: root,
    WAM_MATERIAL_LIBRARY: path.join(root, "material-library.json"),
  },
});
const client = new Client({ name: "wam-verification", version: "1.0.0" });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some((t) => t.name === "nest_job"));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, JSON.stringify(r));
    return JSON.parse(r.content[0].text);
  };
  await call("create_project", {
    file: "test.wam.json",
    name: "test job",
    machine: "pro",
  });
  await call("add_shape", {
    file: "test.wam.json",
    shape: "rectangle",
    width: 30,
    height: 20,
    x: 10,
    y: 10,
  });
  await call("add_shape", {
    file: "test.wam.json",
    shape: "circle",
    width: 15,
    height: 15,
    x: 10,
    y: 10,
  });
  const nested = await call("nest_project", {
    file: "test.wam.json",
    rotate: true,
  });
  assert.equal(nested.parts.length, 2);
  const planned = await call("inspect_toolpaths", { file: "test.wam.json" });
  assert.ok(planned.moves.length > 20);
  assert.deepEqual(planned.issues, []);
  const exported = await client.callTool({
    name: "export_svg",
    arguments: { file: "test.wam.json" },
  });
  assert.match(exported.content[0].text, /<svg/);
  nested.material.feed = 120;
  const written = await call("write_project", {
    file: "test.wam.json",
    project: nested,
  });
  assert.equal(written.material.feed, 120);
  await Promise.all(
    [1, 2].map((i) =>
      call("add_shape", {
        file: "test.wam.json",
        shape: "rectangle",
        width: 10,
        height: 10,
        x: 100 + i * 20,
        y: 100,
      }),
    ),
  );
  const reread = await call("read_project", { file: "test.wam.json" });
  assert.equal(reread.parts.length, 4);
  const catalog = await call("list_material_presets", {
    machine: "pro",
    name: "Aluminum - 6061",
  });
  assert.equal(catalog.presets.length, 20);
  assert.equal(
    (await call("list_material_presets", { machine: "desktop" })).presets
      .length,
    0,
  );
  const preset = catalog.presets.find((p) => p.thicknessIn === 0.125);
  const applied = await call("apply_material_preset", {
    file: "test.wam.json",
    presetId: preset.id,
    quality: "fine",
  });
  assert.equal(applied.material.feed, preset.feeds.fine);
  assert.equal(applied.material.thickness, 3.175);
  assert.equal(applied.material.pierce, preset.pierce);
  const rejected = await client.callTool({
    name: "apply_material_preset",
    arguments: {
      file: "test.wam.json",
      presetId: "pro-18-0.001",
      quality: "medium",
    },
  });
  assert.ok(rejected.isError);
  assert.deepEqual(
    (await call("read_project", { file: "test.wam.json" })).material,
    applied.material,
  );
  const job = await call("create_job", {
    file: "multi.job.json",
    name: "Multi-sheet test",
    machine: "pro",
  });
  const materialId = job.materials[0].id;
  await call("add_job_part", {
    file: "multi.job.json",
    part: {
      id: "job-part",
      name: "Plate",
      contours: [
        {
          closed: true,
          hole: false,
          points: [
            { x: 0, y: 0 },
            { x: 70, y: 0 },
            { x: 70, y: 40 },
            { x: 0, y: 40 },
          ],
        },
      ],
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      cut: "outside",
      materialId,
      quantity: 3,
    },
  });
  job.parts = (await call("read_job", { file: "multi.job.json" })).parts;
  job.sheets[0].stock = { width: 100, height: 70, margin: 3, spacing: 2 };
  await call("write_job", { file: "multi.job.json", job });
  const multi = await call("nest_job", { file: "multi.job.json" });
  assert.equal(multi.sheets.length, 3);
  assert.equal(
    multi.sheets.reduce((sum, s) => sum + s.placements.length, 0),
    3,
  );
  const inspected = await call("inspect_job", { file: "multi.job.json" });
  assert.equal(inspected.sheets.length, 3);
  assert.ok(inspected.sheets[0].pierces.length);
  const library = await call("read_material_library", {});
  library.materials[0].feed = 321;
  await call("write_material_library", { library });
  assert.equal(
    (await call("read_material_library", {})).materials[0].feed,
    321,
  );
  const bad = await client.callTool({
    name: "read_project",
    arguments: { file: "../outside.wam.json" },
  });
  assert.ok(bad.isError);
  console.log(
    "MCP verified over stdio: tool discovery, project creation, shapes, nesting, planning, SVG export, filename validation.",
  );
} finally {
  await client.close();
  await rm(root, { recursive: true, force: true });
}

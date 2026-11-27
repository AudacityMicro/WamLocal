import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { MCP_TOOL_GROUPS, MCP_TOOL_COUNT } from "../src/ui/mcp-guide";
const root = await mkdtemp(path.join(tmpdir(), "wam-workbench-"));
const exe = process.env.WAM_MCP_EXE;
const version = JSON.parse(await readFile("package.json", "utf8"))
  .version as string;
const client = new Client({ name: "workbench-parity-test", version: "1" });
const tested = new Set<string>();
const report: any = { packaged: !!exe, tests: [] };
try {
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
        WAM_PROJECT_DIR: root,
        WAM_MATERIAL_LIBRARY: path.join(root, "materials.json"),
      },
    }),
  );
  const call = async (name: string, args: any = {}) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, `${name}: ${JSON.stringify(r)}`);
    tested.add(name);
    return JSON.parse((r.content[0] as any).text);
  };
  const fail = async (name: string, args: any) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(r.isError, `${name} should fail`);
  };
  const tools = await client.listTools();
  assert.equal(tools.tools.length, MCP_TOOL_COUNT);
  assert.deepEqual(
    tools.tools.map((t) => t.name).sort(),
    MCP_TOOL_GROUPS.flatMap((g) => [...g.tools]).sort(),
  );
  const file = "Parity test.wam";
  let job = await call("create_job", {
    file,
    machine: "desktop",
    name: "PX Parity",
  });
  let library = await call("read_material_library");
  const m = job.materials[0];
  const found = await call("query_material_presets", {
    machine: "desktop",
    name: "6061",
    thickness: 3,
    quality: "medium",
  });
  assert.ok(found.materials.some((p: any) => p.id === m.id));
  assert.ok(found.total >= 1);
  await call("application_settings", {
    displayUnits: "in",
    defaultMachine: "pro",
    showFileLabels: false,
    machine: "desktop",
    machineSettings: { abrasiveCostPerKg: 2, runningCostPerHour: 8 },
    importSettings: { curveToleranceMm: 0.01 },
  });
  let settings = await call("application_settings");
  assert.equal(settings.settings.displayUnits, "in");
  assert.equal(settings.settings.machines.desktop.runningCostPerHour, 8);
  await call("setting_default", {
    action: "save",
    key: "stockToLeave",
    value: 0.127,
    materialId: m.id,
  });
  assert.equal(
    (
      await call("setting_default", {
        action: "resolve",
        key: "stockToLeave",
        fallback: 0,
        materialId: m.id,
      })
    ).value,
    0.127,
  );
  await call("setting_default", {
    action: "save",
    key: "simulation.rapidFeed",
    value: 2500,
  });
  job = await call("configure_job", {
    file,
    stock: { width: 150, height: 100, margin: 5, spacing: 3 },
    tabRules: { count: 0 },
    lead: 1,
    workOrigin: "center-center",
  });
  assert.equal(job.sheets[0].workOrigin, "center-center");
  job = await call("create_part", {
    file,
    name: "Plate",
    shape: "rectangle",
    width: 30,
    height: 20,
    quantity: 2,
  });
  const p = job.parts[0];
  assert.equal(p.stockToLeave, 0.127);
  job = await call("edit_part", {
    file,
    partId: p.id,
    changes: {
      stockToLeave: 0.127,
      rotationPolicy: "fixed",
      process: { ...m, feed: 222, pierce: 1.5 },
    },
  });
  assert.equal(job.parts[0].stockToLeave, 0.127);
  job = await call("edit_contour", {
    file,
    partId: p.id,
    action: "add",
    changes: {
      closed: true,
      hole: true,
      points: Array.from({ length: 64 }, (_, i) => ({
        x: 15 + 3 * Math.cos((i * Math.PI) / 32),
        y: 10 + 3 * Math.sin((i * Math.PI) / 32),
      })),
    },
  });
  job = await call("edit_contour", {
    file,
    partId: p.id,
    action: "update",
    contourIndex: 0,
    changes: {
      tabMode: "manual",
      tabs: [{ position: 0.2, width: 0.5 }],
      startPosition: 0.7,
      lead: 0.8,
    },
  });
  assert.equal(job.parts[0].contours[0].tabs[0].width, 0.5);
  job = await call("edit_contour", {
    file,
    partId: p.id,
    action: "update",
    contourIndex: 0,
    changes: { tabMode: "none" },
    resetFields: ["tabs", "startPosition", "lead"],
  });
  assert.equal(job.parts[0].contours[0].lead, undefined);
  const h = await call("job_history", { file, action: "status" });
  assert.ok(h.undo >= 4);
  job = (await call("job_history", { file, action: "undo" })).job;
  assert.equal(job.parts[0].contours[0].lead, 0.8);
  job = (await call("job_history", { file, action: "redo" })).job;
  assert.equal(job.parts[0].contours[0].lead, undefined);
  job = await call("duplicate_parts", { file, partIds: [p.id] });
  const copy = job.parts[1];
  assert.notEqual(copy.id, p.id);
  assert.equal(copy.contours.length, 2);
  job = await call("delete_parts", { file, partIds: [copy.id] });
  assert.equal(job.parts.length, 1);
  const sheetId = job.sheets[0].id;
  job = await call("place_part", {
    file,
    partId: p.id,
    sheetId,
    x: 8,
    y: 8,
    rotation: 0,
  });
  const placement = job.sheets[0].placements[0];
  job = await call("edit_placements", {
    file,
    sheetId,
    placementIds: [placement.id],
    action: "duplicate",
    dx: 45,
    dy: 0,
  });
  assert.equal(job.sheets[0].placements.length, 2);
  const second = job.sheets[0].placements[1];
  job = await call("edit_placements", {
    file,
    sheetId,
    placementIds: [second.id],
    action: "transform",
    dy: 10,
    rotationDelta: 10,
    locked: true,
  });
  assert.equal(job.sheets[0].placements[1].locked, true);
  job = await call("edit_placements", {
    file,
    sheetId,
    placementIds: [second.id],
    action: "transform",
    rotationDelta: -10,
    locked: false,
  });
  job = await call("nest_sheet", { file, sheetId });
  assert.equal(job.sheets[0].placements.length, 2);
  const svg = await client.callTool({
    name: "export_job_svg",
    arguments: { file, sheetId, toolpaths: true },
  });
  assert.ok(!svg.isError);
  assert.match((svg.content[0] as any).text, /<svg/);
  assert.match((svg.content[0] as any).text, /#e38e3b/);
  tested.add("export_job_svg");
  const sim = await call("simulate_sheet", {
    file,
    sheetId,
    seconds: 10,
    limit: 3,
  });
  assert.equal(sim.events.length, 3);
  assert.ok(sim.seconds > 10);
  assert.ok(sim.nextOffset);
  assert.ok(sim.estimate.cost.total > 0);
  const cutting = await call("simulate_sheet", { file, sheetId, limit: 2000 });
  assert.ok(
    cutting.events.some((e: any) => e.kind === "cut" && e.feed === 222),
  );
  const step = await call("simulate_sheet", {
    file,
    sheetId,
    eventIndex: 2,
    limit: 0,
  });
  assert.equal(step.events.length, 0);
  assert.equal(step.nextOffset, null);
  assert.ok(step.at.event);
  await fail("simulate_sheet", { file, sheetId, eventIndex: 100000000 });
  // Background workers remain responsive and protect concurrent document edits.
  const waitForSearch = async (searchId: string) => {
    for (let i = 0; i < 200; i++) {
      const state = await call("nesting_status", { searchId });
      if (state.status !== "running") return state;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error("Background search did not finish");
  };
  const background = await call("start_nesting", {
    file,
    sheetId,
    settings: { budgetMode: "fixed", budgetSeconds: 1, optimize: false },
  });
  const done = await waitForSearch(background.searchId);
  assert.equal(done.status, "completed", JSON.stringify(done));
  assert.equal(done.saved, true);
  job = await call("edit_part", {
    file,
    partId: p.id,
    changes: { quantity: 1000 },
  });
  const beforeCancel = await readFile(path.join(root, file), "utf8");
  const long = await call("start_nesting", {
    file,
    settings: {
      budgetMode: "fixed",
      budgetSeconds: 30,
      optimize: true,
      restarts: 64,
      stallPasses: 10,
      allowNewSheets: false,
    },
  });
  const cancelled = await call("stop_nesting", {
    searchId: long.searchId,
    keepBest: false,
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.saved, false);
  assert.equal(await readFile(path.join(root, file), "utf8"), beforeCancel);
  job = await call("edit_part", {
    file,
    partId: p.id,
    changes: { quantity: 2 },
  });
  const concurrent = await call("start_nesting", {
    file,
    settings: { budgetMode: "fixed", budgetSeconds: 1, optimize: false },
  });
  await call("configure_job", { file, name: "Newer manual name" });
  const conflict = await waitForSearch(concurrent.searchId);
  assert.equal(conflict.status, "conflict", JSON.stringify(conflict));
  assert.equal(conflict.saved, false);
  assert.equal((await call("read_job", { file })).name, "Newer manual name");
  report.tests.push({
    backgroundNesting: true,
    cancelPreservesFile: true,
    concurrentEditsProtected: true,
  });
  const extra = {
    ...job.sheets[0],
    id: "extra-sheet",
    name: "Extra",
    placements: [],
  };
  job = await call("add_sheet", { file, sheet: extra });
  job = await call("remove_sheet", { file, sheetId: extra.id });
  assert.equal(job.sheets.length, 1);
  await fail("remove_sheet", { file, sheetId });
  let preset = (
    await call("edit_material_preset", {
      action: "duplicate",
      materialId: m.id,
      changes: { name: "QA Alloy", stockKey: "QA Alloy", feed: 123 },
    })
  ).material;
  job = await call("apply_job_material", { file, materialId: preset.id });
  assert.equal(
    job.materials.find((v: any) => v.id === job.sheets[0].materialId).feed,
    123,
  );
  const edited = await call("edit_material_preset", {
    action: "update",
    materialId: preset.id,
    changes: { feed: 125 },
    jobFile: file,
  });
  assert.equal(edited.material.feed, 125);
  await call("edit_material_preset", {
    action: "create",
    material: {
      ...preset,
      id: "qa-created",
      name: "Created alloy",
      stockKey: "Created alloy",
    },
  });
  await call("edit_material_preset", {
    action: "delete",
    materialId: "qa-created",
  });
  await fail("apply_job_material", {
    file,
    materialId: library.materials.find((v: any) => v.machine === "pro").id,
  });
  await call("save_job_as", { file, target: "Copy of parity.wam" });
  await fail("save_job_as", { file, target: "Copy of parity.wam" });
  assert.ok(
    (await call("list_workspace")).files.includes("Copy of parity.wam"),
  );
  // Actual Chromium imports: outlines, text, linked image, binary/text DXF decoding and failures.
  const drawing =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 20 10"><path d="M0 0H20V10H0Z"/></svg>';
  await writeFile(path.join(root, "outline.svg"), drawing);
  const text =
    '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="15mm" viewBox="0 0 100 50"><text x="5" y="35" font-size="30">AB</text></svg>';
  const imported = await call("import_parts", {
    file,
    inputs: [
      { path: "outline.svg" },
      { name: "text.svg", source: text },
      { name: "bad.svg", source: "<svg><bad/></svg>" },
      { path: "../outside.svg" },
    ],
  });
  assert.equal(imported.imported.length, 2, JSON.stringify(imported.errors));
  assert.equal(imported.errors.length, 2);
  assert.ok(imported.imported[1].contours >= 2);
  await mkdir(path.join(root, "art"));
  for (const name of [
    "trace-ring.png",
    "linked-image.svg",
    "image.dxf",
    "text-ellipse.dxf",
  ])
    await copyFile(
      path.join("fixtures/artwork", name),
      path.join(root, "art", name),
    );
  const artwork = await call("import_parts", {
    file,
    inputs: [
      "linked-image.svg",
      "image.dxf",
      "text-ellipse.dxf",
      "trace-ring.png",
    ].map((name) => ({ path: "art/" + name })),
  });
  assert.equal(artwork.errors.length, 0, JSON.stringify(artwork.errors));
  assert.equal(artwork.imported.length, 4);
  report.tests.push({
    artwork: artwork.imported.map((v: any) => ({
      name: v.name,
      contours: v.contours,
    })),
  });
  // Original user DXFs are copied into the isolated test folder if available.
  for (const name of ["4B5DEAB_model_r_0.dxf", "4B5DE4F_model_r_0.dxf"]) {
    try {
      await copyFile(
        path.join("C:/Users/AJ/Downloads", name),
        path.join(root, name),
      );
      const result = await call("import_parts", {
        file,
        inputs: [{ path: name }],
      });
      assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
      assert.equal(result.imported.length, 1);
      report.tests.push({
        drawing: name,
        contours: result.imported[0].contours,
      });
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  // Duplicate cleanup and pierce-only posting through the actual import server.
  const shimFile = "Shim test.wam";
  let shimJob = await call("create_job", {
    file: shimFile,
    machine: "desktop",
    name: "SH Shim",
  });
  await copyFile(
    "fixtures/dxf/shim-duplicate.dxf",
    path.join(root, "Shim.dxf"),
  );
  const shimImported = await call("import_parts", {
    file: shimFile,
    inputs: [{ path: "Shim.dxf" }],
  });
  assert.equal(shimImported.errors.length, 0);
  shimJob = shimImported.job;
  assert.equal(shimJob.parts[0].contours.length, 6);
  assert.equal(shimJob.parts[0].contours.filter((c: any) => c.hole).length, 5);
  await call("configure_job", { file: shimFile, tabRules: { count: 0 } });
  await call("place_part", {
    file: shimFile,
    partId: shimJob.parts[0].id,
    sheetId: shimJob.sheets[0].id,
    x: 20,
    y: 20,
  });
  const shimPosted = await call("post_all", { file: shimFile });
  assert.equal(shimPosted.sheets[0].operations, 6);
  assert.equal(shimPosted.sheets[0].pierceOnlyOperations, 2);
  const shimSimulation = await call("simulate_sheet", {
    file: shimFile,
    sheetId: shimJob.sheets[0].id,
    limit: 2000,
  });
  assert.equal(
    shimSimulation.events.filter((e: any) => e.kind === "pierce").length,
    6,
  );
  report.tests.push({
    shim: {
      profiles: 6,
      holes: 5,
      operations: 6,
      pierceOnlyOperations: 2,
      simulatedPierces: 6,
    },
  });
  // External edits invalidate undo instead of overwriting another editor's work.
  const current = JSON.parse(await readFile(path.join(root, file), "utf8"));
  current.name = "External";
  current.nameMode = "manual";
  await writeFile(path.join(root, file), JSON.stringify(current));
  await fail("job_history", { file, action: "undo" });
  report.tools = MCP_TOOL_COUNT;
  report.exercised = [...tested].sort();
  report.tests.push({
    imports: 2,
    expectedImportFailures: 2,
    manualName: true,
    simulation: true,
    undoRedo: true,
    externalEditProtection: true,
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
  await rm(root, { recursive: true, force: true });
}
await writeFile(
  `artifacts/mcp-workbench-${exe ? "packaged" : "source"}-${version}.json`,
  JSON.stringify(report, null, 2),
);

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = await mkdtemp(path.join(tmpdir(), "wam-step-"));
const exe = process.env.WAM_MCP_EXE,
  version = JSON.parse(await readFile("package.json", "utf8")).version;
const client = new Client({ name: "step-import-test", version: "1" });
const report: any = { version, packaged: !!exe, tests: [] };
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
  const call = async (name: string, args: any) => {
    const r = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 180000,
    });
    assert.ok(!r.isError, JSON.stringify(r));
    return JSON.parse((r.content[0] as any).text);
  };
  for (const machine of ["desktop", "pro"]) {
    const file = `STEP ${machine}.wam`;
    let job = await call("create_job", {
      file,
      machine,
      name: `STEP .020 ${machine}`,
    });
    const result = await call("import_parts", {
      file,
      inputs: [
        {
          name: "drilled-plate.step",
          encoding: "base64",
          source: (await readFile("fixtures/step/drilled-plate.step")).toString(
            "base64",
          ),
        },
        {
          name: "sphere.step",
          encoding: "base64",
          source: (await readFile("fixtures/step/sphere.step")).toString(
            "base64",
          ),
        },
      ],
    });
    assert.equal(result.imported.length, 1);
    assert.equal(result.errors.length, 1);
    job = await call("read_job", { file });
    const part = job.parts[0];
    assert.equal(part.contours.filter((c: any) => c.hole).length, 2);
    const chosen = part.stepSource.selected,
      side = part.stepSource.faces.find((f: any) => f.area < 1000).id;
    await call("edit_part", {
      file,
      partId: part.id,
      stepFaceId: side,
      changes: {},
    });
    await call("edit_part", {
      file,
      partId: part.id,
      stepFaceId: chosen,
      changes: { quantity: 0 },
    });
    await call("configure_job", {
      file,
      workOriginReference: "parts",
      workOrigin: "center-center",
    });
    job = await call("read_job", { file });
    assert.equal(job.parts[0].quantity, 0);
    assert.equal(job.sheets[0].workOriginReference, "parts");
    await call("edit_part", {
      file,
      partId: part.id,
      changes: { quantity: 1 },
    });
    await call("place_part", {
      file,
      partId: part.id,
      sheetId: job.sheets[0].id,
      x: 20,
      y: 20,
    });
    await call("configure_job", { file, tabRules: { count: 0, width: 0.5 } });
    await call("edit_contour", {
      file,
      partId: part.id,
      action: "update",
      contourIndex: 0,
      changes: { leadInOverlap: 0.5, leadOutOverlap: 0.5 },
    });
    const posted = await call("post_all", { file, replace: false });
    assert.equal(posted.paths.length, 1);
    assert.equal(posted.sheets[0].operations, 3);
    const code = await readFile(posted.paths[0], "utf8");
    assert.ok(code.includes("parts bounds"));
    assert.equal(path.basename(posted.paths[0]).split(".").length, 2);
    report.tests.push({
      machine,
      holes: 2,
      storedFaces: part.stepSource.faces.length,
      faceOverride: true,
      zeroQuantity: true,
      partsWcs: true,
      posted,
    });
  }
} finally {
  await client.close();
  await rm(root, { recursive: true, force: true });
}
await writeFile(
  `artifacts/step-${exe ? "packaged" : "source"}-${version}.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));

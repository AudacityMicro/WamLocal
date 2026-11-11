import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ headless: true, timeout: 30000 });
try {
  const page = await browser.newPage({
    viewport: { width: 1536, height: 960 },
  });
  page.setDefaultTimeout(10000);
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("Browser error:", msg.text());
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("heading", { name: "Design & arrange" }).waitFor();
  assert.equal(await page.locator(".parts-table button").count(), 4);
  await page.locator(".parts-table button").first().click();
  await page
    .getByRole("spinbutton", { name: "Position X", exact: true })
    .fill("45");
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "Position X", exact: true })
      .inputValue(),
    "45",
  );
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  assert.equal(await page.locator(".parts-table button").count(), 5);
  await page.getByRole("button", { name: "Nesting", exact: true }).click();
  await page
    .getByRole("button", { name: "Nest all 5 parts", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "Parts nested" }).waitFor();
  await page
    .getByRole("button", { name: "Inspect toolpaths", exact: true })
    .click();
  await page.getByRole("heading", { name: "Cut strategy" }).waitFor();
  assert.ok((await page.locator("svg.bed > line").count()) > 20);
  await page.getByRole("button", { name: "Design", exact: true }).click();
  if (await page.getByRole("button", { name: "Dismiss", exact: true }).count())
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.locator('input[type=file][accept=".svg,.dxf"]').setInputFiles({
    name: "test.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><g transform="translate(10 5)"><path d="M0 0H80V40H0Z M20 10H60V30H20Z"/></g></svg>',
    ),
  });
  await page.getByRole("status").waitFor();
  console.log("SVG import result:", await page.getByRole("status").innerText());
  assert.equal(await page.locator(".parts-table button").count(), 6);
  const draft = JSON.parse(
    await page.evaluate(() => localStorage.getItem("wam-local-draft")),
  );
  const imported = draft.parts.at(-1);
  assert.equal(imported.contours.length, 2);
  assert.equal(imported.contours.filter((c) => c.hole).length, 1);
  assert.ok(
    Math.abs(Math.max(...imported.contours[0].points.map((p) => p.x)) - 80) <
      0.01,
  );
  await page
    .getByRole("button", { name: "Edit nodes (N)", exact: true })
    .click();
  const handle = await page
    .locator("svg.bed > g")
    .last()
    .locator("circle")
    .first()
    .boundingBox();
  assert.ok(handle);
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 12,
    handle.y + handle.height / 2 + 10,
    { steps: 3 },
  );
  await page.mouse.up();
  const edited = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("wam-local-draft")).parts.at(-1),
  );
  assert.notDeepEqual(
    edited.contours[0].points[0],
    imported.contours[0].points[0],
  );
  await page
    .getByRole("button", { name: "Undo (Ctrl Z)", exact: true })
    .click();
  const undone = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("wam-local-draft")).parts.at(-1),
  );
  assert.deepEqual(
    undone.contours[0].points[0],
    imported.contours[0].points[0],
  );
  await page
    .getByRole("button", {
      name: "Draw polygon (P); Enter closes; Shift Enter leaves open",
      exact: true,
    })
    .click();
  const clicks = await page.locator("svg.bed").evaluate((el) =>
    [
      [220, 180],
      [250, 180],
      [235, 205],
    ].map(([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM());
      return { x: p.x, y: p.y };
    }),
  );
  for (const p of clicks) await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".parts-table button").count(), 7);
  await page.keyboard.press("Delete");
  assert.equal(await page.locator(".parts-table button").count(), 6);
  await page
    .locator('input[type=file][accept=".svg,.dxf"]')
    .setInputFiles({
      name: "test.dxf",
      mimeType: "application/dxf",
      buffer: Buffer.from(
        "0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\n0\n10\n0\n20\n0\n30\n0\n40\n10\n0\nENDSEC\n0\nEOF\n",
      ),
    });
  await page
    .getByRole("status")
    .filter({ hasText: "Imported vectors" })
    .waitFor();
  assert.equal(await page.locator(".parts-table button").count(), 7);
  await page.locator('input[type=file][accept=".svg,.dxf"]').setInputFiles({
    name: "bad.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ),
  });
  await page.getByRole("status").filter({ hasText: "unsupported" }).waitFor();
  assert.equal(await page.locator(".parts-table button").count(), 7);
  await page.reload();
  await page.getByRole("heading", { name: "Design & arrange" }).waitFor();
  assert.equal(await page.locator(".parts-table button").count(), 7);
  // Restore sample scene for the screenshot and verify a clean first-use experience.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("heading", { name: "Design & arrange" }).waitFor();
  await page.locator(".parts-table button").first().click();
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/workbench.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "UI verified: sample, numeric transform, duplication, nesting, toolpath preview, SVG physical dimensions, hole preservation, active content rejection, persistence.",
  );
} finally {
  await browser.close();
}

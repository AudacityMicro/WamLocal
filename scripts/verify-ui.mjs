import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { verifyWorkbench } from "./verify-workbench.mjs";
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1536,height:960}});
  await page.goto("http://127.0.0.1:5173");
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await verifyWorkbench(page);
  assert.deepEqual(errors,[]);
  console.log("Current Jobs/part editor UI verified, including preset placement retention, deletion persistence and material application.");
} finally { await browser.close(); }

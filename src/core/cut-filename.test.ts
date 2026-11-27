import { it, expect } from "vitest";
import {
  cutFilename,
  validCutFilename,
  jobFilename,
  downloadFilename,
} from "./cut-filename";
it("uses the full job name for one sheet and stable sheet numbers for a multi-sheet job", () => {
  expect(cutFilename("Mounting bracket", 1, 1)).toBe("Mounting bracket.gcode");
  expect(cutFilename("Mounting bracket", 2, 3)).toBe(
    "Mounting bracket - Sheet 2.gcode",
  );
  expect(cutFilename("2026-11-24 · Aluminum 6061 · 0.02 in", 1, 1)).toBe(
    "2026-11-24 · Aluminum 6061 · 0_02 in.gcode",
  );
});
it("replaces every internal period while preserving the final file extension", () => {
  expect(cutFilename("6061 .020 rev.2.gcode", 1, 1)).toBe(
    "6061 _020 rev_2.gcode",
  );
  expect(jobFilename("6061 .020 rev.2.wam")).toBe("6061 _020 rev_2.wam");
  expect(downloadFilename("test.1.backup.json")).toBe("test_1_backup.json");
  expect(jobFilename("CON")).toBe("Job - CON.wam");
  expect(jobFilename('bad<>:"/\\|?*\u0000. ')).toMatch(/^bad_+\.wam$/);
  expect(validCutFilename("a.b.gcode")).toBe(false);
});
it("sanitizes invalid names and accepts descriptive names without allowing paths or devices", () => {
  for (const name of [
    "CON",
    "../../bracket:1",
    "  ",
    "a".repeat(500),
    "🔥".repeat(100),
  ])
    expect(validCutFilename(cutFilename(name, 1, 1))).toBe(true);
  for (const name of [
    "../out.gcode",
    "CON.gcode",
    "a\\b.gcode",
    "bad?.gcode",
    ".gcode",
  ])
    expect(validCutFilename(name)).toBe(false);
});

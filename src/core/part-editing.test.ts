import { describe, expect, it } from "vitest";
import { circle, makePart, newProject, rectangle } from "./model";
import { encodePartClipboard, pastePartClipboard } from "./part-clipboard";
import { partCenter, rotatePartFromPointer } from "./part-transform";
import { distance, transformed } from "./geometry";
import { createRequire } from "node:module";
import { vi } from "vitest";
const { registerPartClipboard } = createRequire(import.meta.url)(
  "../../electron/clipboard.cjs",
);

describe("part clipboard", () => {
  const part = {
    ...makePart(
      "Plate",
      [rectangle(50, 30), { ...circle(5), hole: true }],
      20,
      40,
    ),
    rotation: 32,
    scale: 1.7,
    cut: "inside" as const,
  };
  it("copies a complete immutable snapshot with fresh IDs when pasted across projects", () => {
    const source = structuredClone(part);
    const text = encodePartClipboard([source]);
    source.contours[0].points[0].x = 900;
    const target = newProject();
    target.material.feed = 123;
    const result = pastePartClipboard(target, text);
    expect(target.parts).toEqual([]);
    expect(result.project.parts[0]).toMatchObject({
      ...part,
      id: expect.any(String),
      name: "Plate copy",
      x: 28,
      y: 48,
    });
    expect(result.project.parts[0].id).not.toBe(part.id);
    expect(result.ids).toEqual([result.project.parts[0].id]);
    expect(result.project.material.feed).toBe(123);
  });
  it("offsets repeated pastes and preserves relative positions in a group", () => {
    const text = encodePartClipboard([
      part,
      { ...part, id: "second", x: 100, y: 200 },
    ]);
    const first = pastePartClipboard(newProject(), text);
    const second = pastePartClipboard(first.project, text, 2);
    expect(second.project.parts.map((p) => [p.x, p.y])).toEqual([
      [28, 48],
      [108, 208],
      [36, 56],
      [116, 216],
    ]);
    expect(new Set(second.project.parts.map((p) => p.id)).size).toBe(4);
  });
  it("rejects unrelated, corrupted, unsupported or oversized clipboard data", () => {
    for (const text of [
      "ordinary text",
      "{}",
      encodePartClipboard([part]).replace('"version":1', '"version":2'),
      encodePartClipboard([part]).replace('"scale":1.7', '"scale":-1'),
    ])
      expect(() => pastePartClipboard(newProject(), text)).toThrow(
        /does not contain Wam Local parts/,
      );
    expect(() =>
      pastePartClipboard(newProject(), " ".repeat(10_000_001)),
    ).toThrow(/10 MB/);
    expect(() =>
      pastePartClipboard(newProject(), encodePartClipboard([part]), 0),
    ).toThrow(/offset/);
    expect(() =>
      pastePartClipboard(
        {
          ...newProject(),
          parts: Array.from({ length: 2000 }, (_, i) => ({
            ...part,
            id: String(i),
          })),
        },
        encodePartClipboard([part]),
      ),
    ).toThrow(/2,000-part/);
  });
});
describe("mouse rotation", () => {
  it("rotates around the fixed center without changing size, holes or local geometry", () => {
    const part = {
      ...makePart(
        "Plate",
        [rectangle(40, 20), { ...circle(3), hole: true }],
        100,
        80,
      ),
      rotation: 30,
      scale: 1.8,
    };
    const original = structuredClone(part),
      center = partCenter(part);
    const start = { x: center.x + 40, y: center.y },
      end = { x: center.x, y: center.y + 40 };
    const rotated = rotatePartFromPointer(part, center, start, end);
    expect(rotated.rotation).toBeCloseTo(120, 10);
    expect(distance(partCenter(rotated), center)).toBeLessThan(1e-10);
    expect(rotated.contours).toEqual(part.contours);
    expect(part).toEqual(original);
    const before = transformed(part)[0].points,
      after = transformed(rotated)[0].points;
    expect(distance(after[0], after[1])).toBeCloseTo(
      distance(before[0], before[1]),
      10,
    );
  });
  it("snaps absolute rotation to 15 degrees and crosses the angle wrap smoothly", () => {
    const part = makePart("Rectangle", [rectangle(40, 20)]),
      center = partCenter(part);
    const at = (deg: number) => ({
      x: center.x + 50 * Math.cos((deg * Math.PI) / 180),
      y: center.y + 50 * Math.sin((deg * Math.PI) / 180),
    });
    const snapped = rotatePartFromPointer(part, center, at(0), at(23), true);
    expect(snapped.rotation).toBe(30);
    expect(distance(partCenter(snapped), center)).toBeLessThan(1e-10);
    expect(
      rotatePartFromPointer(part, center, at(179), at(-179)).rotation,
    ).toBeCloseTo(2, 10);
    expect(
      rotatePartFromPointer(part, center, at(0), at(-90)).rotation,
    ).toBeCloseTo(270, 10);
    expect(rotatePartFromPointer(part, center, at(0), center)).toEqual(part);
  });
});

describe("desktop part clipboard bridge", () => {
  function bridge() {
    const handlers: Record<string, (...args: any[]) => any> = {};
    const ipcMain = {
      handle: (name: string, fn: any) => {
        handlers[name] = fn;
      },
      on: (name: string, fn: any) => {
        handlers[name] = fn;
      },
    };
    const clipboard = { writeText: vi.fn() };
    const mainFrame = {},
      webContents = { mainFrame, paste: vi.fn() };
    const win = { isDestroyed: () => false, webContents };
    registerPartClipboard({ ipcMain, clipboard, win });
    return {
      handlers,
      clipboard,
      win,
      event: { sender: webContents, senderFrame: mainFrame },
    };
  }
  it("writes only a valid part envelope and requests a normal paste event", () => {
    const h = bridge(),
      text = encodePartClipboard([makePart("part", [rectangle()])]);
    h.handlers["wam:copy-part"](h.event, text);
    expect(h.clipboard.writeText).toHaveBeenCalledWith(text);
    h.handlers["wam:paste-parts"](h.event);
    expect(h.win.webContents.paste).toHaveBeenCalledOnce();
    expect(Object.keys(h.handlers)).toEqual([
      "wam:copy-part",
      "wam:paste-parts",
    ]);
  });
  it("rejects other windows and subframes", () => {
    const h = bridge(),
      text = encodePartClipboard([makePart("part", [rectangle()])]);
    for (const event of [
      { ...h.event, sender: {} },
      { ...h.event, senderFrame: {} },
    ]) {
      expect(() => h.handlers["wam:copy-part"](event, text)).toThrow(
        /rejected/,
      );
      h.handlers["wam:paste-parts"](event);
    }
    expect(h.clipboard.writeText).not.toHaveBeenCalled();
    expect(h.win.webContents.paste).not.toHaveBeenCalled();
  });
  it("rejects unrelated and oversized copy payloads", () => {
    const h = bridge();
    for (const text of ["ordinary text", "{}", " ".repeat(10_000_001)])
      expect(() => h.handlers["wam:copy-part"](h.event, text)).toThrow();
    expect(h.clipboard.writeText).not.toHaveBeenCalled();
  });
});

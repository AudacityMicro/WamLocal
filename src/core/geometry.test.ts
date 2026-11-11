import { describe, it, expect } from "vitest";
import {
  rectangle,
  circle,
  makePart,
  newProject,
  projectSchema,
} from "./model";
import {
  area,
  bounds,
  offset,
  nest,
  partBounds,
  plan,
  distance,
  svgExport,
} from "./geometry";
describe("kerf and paths", () => {
  it("expands outer contours and contracts holes independent of winding", () => {
    for (const points of [
      rectangle(20, 10).points,
      rectangle(20, 10).points.reverse(),
    ]) {
      expect(
        bounds(offset({ ...rectangle(), points }, 1)[0].points).width,
      ).toBeCloseTo(22);
      expect(
        bounds(offset({ ...rectangle(), points }, -1)[0].points).width,
      ).toBeCloseTo(18);
    }
  });
  it("plans holes first and removes the correct total tab length", () => {
    const p = newProject();
    p.material = { ...p.material, kerf: 0, lead: 0, tabCount: 2, tabWidth: 2 };
    p.parts = [
      makePart(
        "plate",
        [rectangle(50, 50), { ...circle(5), hole: true }],
        20,
        20,
      ),
    ];
    const result = plan(p);
    expect(distance(result.moves[0].to, { x: 30, y: 25 })).toBeLessThan(0.001);
    expect(
      result.moves
        .filter((m) => m.kind === "tab")
        .reduce((s, m) => s + distance(m.from, m.to), 0),
    ).toBeCloseTo(4);
    expect(result.issues).toEqual([]);
  });
  it("reports out of stock toolpaths and vanished holes", () => {
    const p = newProject();
    p.parts = [
      makePart(
        "plate",
        [rectangle(460, 305), { ...circle(0.1), hole: true }],
        0,
        0,
      ),
    ];
    expect(plan(p).issues.join(" ")).toMatch(/outside the stock/);
    expect(plan(p).issues.join(" ")).toMatch(/removes a contour/);
  });
  it("does not manufacture a closed offset for open centerline paths", () => {
    const p = newProject();
    p.parts = [
      {
        ...makePart(
          "line",
          [
            {
              closed: false,
              hole: false,
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
              ],
            },
          ],
          20,
          20,
        ),
        cut: "centerline",
      },
    ];
    expect(plan(p).cutLength).toBeCloseTo(20);
    expect(plan(p).moves.filter((m) => m.kind === "cut")).toHaveLength(1);
  });
});
describe("nesting", () => {
  it("packs parts with clearance without changing their contours", () => {
    const p = newProject();
    p.parts = Array.from({ length: 12 }, (_, i) =>
      makePart(`part ${i}`, [rectangle(70, 40)], 100, 100),
    );
    const result = nest(p);
    expect(result.parts.length).toBe(12);
    result.parts.forEach((part, i) => {
      expect(part.contours).toEqual(p.parts[i].contours);
      const b = partBounds(part);
      expect(b.x).toBeGreaterThanOrEqual(p.stock.margin);
      expect(b.x + b.width).toBeLessThanOrEqual(460 - p.stock.margin);
    });
    expect(plan(result).issues).toEqual([]);
  });
  it("fits a part only when rotation is enabled", () => {
    const p = newProject();
    p.stock = { width: 100, height: 70, margin: 0, spacing: 0 };
    p.material.lead = 0;
    p.material.kerf = 0;
    p.parts = [makePart("rotated", [rectangle(60, 90)])];
    expect(() => nest(p, false)).toThrow();
    const b = partBounds(nest(p, true).parts[0]);
    expect(b.width).toBeCloseTo(90);
    expect(b.height).toBeCloseTo(60);
  });
  it("rejects jobs requiring more than one stock sheet", () => {
    const p = newProject();
    p.parts = [makePart("huge", [rectangle(800, 800)])];
    expect(() => nest(p)).toThrow(/fit/);
  });
});
describe("project exchange", () => {
  it("computes bounds for large imports without spreading function arguments", () => {
    const b = bounds(
      Array.from({ length: 200000 }, (_, i) => ({ x: i, y: i % 20 })),
    );
    expect(b.width).toBe(199999);
    expect(b.height).toBe(19);
  });
  it("rejects invalid dimensions, duplicate IDs and nonfinite geometry", () => {
    const p = newProject();
    p.parts = [makePart("test", [rectangle()])];
    expect(() =>
      projectSchema.parse({ ...p, stock: { ...p.stock, width: 500 } }),
    ).toThrow();
    expect(() =>
      projectSchema.parse({ ...p, parts: [p.parts[0], p.parts[0]] }),
    ).toThrow();
    expect(() =>
      projectSchema.parse({ ...p, parts: [{ ...p.parts[0], x: Infinity }] }),
    ).toThrow();
  });
  it("exports physical units and transformed geometry", () => {
    const p = newProject();
    p.parts = [makePart("plate", [rectangle()], 20, 30)];
    const s = svgExport(p);
    expect(s).toContain('width="460mm"');
    expect(s).toContain("M20,30");
    expect(area(rectangle(20, 10).points)).toBe(200);
  });
});

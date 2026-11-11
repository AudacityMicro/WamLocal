import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { importDxf } from "./import";
import { flattenDxfPolyline, DXF_CURVE_TOLERANCE_MM } from "./dxf-polyline";
import { bounds, area, distance, plan } from "./geometry";
import { newProject, projectSchema } from "./model";
type Vertex = { x: number; y: number; bulge?: number };
function polyline(
  type: "LWPOLYLINE" | "POLYLINE",
  vertices: Vertex[],
  closed = false,
  normal = 1,
) {
  const header = type === "LWPOLYLINE" ? `90\n${vertices.length}\n` : "66\n1\n";
  return (
    `0\n${type}\n8\n0\n${header}70\n${closed ? 1 : 0}\n210\n0\n220\n0\n230\n${normal}\n` +
    vertices
      .map(
        (v) =>
          `${type === "POLYLINE" ? "0\nVERTEX\n8\n0\n" : ""}10\n${v.x}\n20\n${v.y}\n42\n${v.bulge ?? 0}\n`,
      )
      .join("") +
    (type === "POLYLINE" ? "0\nSEQEND\n" : "")
  );
}
function document(entities: string, units = 4) {
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${units}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}
const curveLength = (points: Vertex[], closed = false) =>
  points.reduce(
    (sum, p, i) =>
      sum +
      (i
        ? distance(points[i - 1], p)
        : closed
          ? distance(points.at(-1)!, p)
          : 0),
    0,
  );

describe("DXF bulged polyline import", () => {
  it("imports the rounded-plate fixture with quarter-circle corners and a two-vertex circular hole", () => {
    const source = readFileSync(
      new URL("../../fixtures/dxf/bulged-rounded-plate.dxf", import.meta.url),
      "utf8",
    );
    const part = importDxf(source, "rounded plate");
    expect(part.contours.map((c) => c.hole)).toEqual([false, true]);
    const outer = part.contours[0];
    expect(bounds(outer.points)).toMatchObject({ width: 60, height: 40 });
    expect(
      Math.abs(Math.abs(area(outer.points)) - (2400 - (4 - Math.PI) * 25)),
    ).toBeLessThan(3);
    expect(
      Math.abs(curveLength(outer.points, true) - (160 + 10 * Math.PI)),
    ).toBeLessThan(0.3);
  });
  for (const type of ["LWPOLYLINE", "POLYLINE"] as const) {
    for (const sign of [1, -1])
      it(`imports ${type} ${sign > 0 ? "CCW" : "CW"} semicircles with correct direction and physical size`, () => {
        const part = importDxf(
          document(
            polyline(type, [
              { x: 0, y: 0, bulge: sign },
              { x: 20, y: 0, bulge: 9 },
            ]),
          ),
          "arc",
        );
        const c = part.contours[0],
          b = bounds(c.points);
        expect(c.closed).toBe(false);
        expect(c.points.length).toBeGreaterThan(3);
        expect(b.width).toBeCloseTo(20, 10);
        expect(Math.abs(b.height - 10)).toBeLessThanOrEqual(
          DXF_CURVE_TOLERANCE_MM,
        );
        expect(
          Math.abs(c.points[0].y - (sign === 1 ? 0 : 10)),
        ).toBeLessThanOrEqual(DXF_CURVE_TOLERANCE_MM);
        expect(c.points.at(-1)!.x).toBe(20);
        expect(Math.abs(curveLength(c.points) - 10 * Math.PI)).toBeLessThan(
          0.1,
        );
      });
    it(`uses the final ${type} bulge to close a circular hole`, () => {
      const rectangle = polyline(
        type,
        [
          { x: 0, y: 0 },
          { x: 60, y: 0 },
          { x: 60, y: 40 },
          { x: 0, y: 40 },
        ],
        true,
      );
      const hole = polyline(
        type,
        [
          { x: 25, y: 20, bulge: 1 },
          { x: 35, y: 20, bulge: 1 },
        ],
        true,
      );
      const part = importDxf(
        document(rectangle + hole),
        "plate with circular hole",
      );
      expect(part.contours.map((c) => c.hole)).toEqual([false, true]);
      const c = part.contours[1];
      expect(c.closed).toBe(true);
      expect(Math.abs(Math.abs(area(c.points)) - 25 * Math.PI)).toBeLessThan(
        Math.PI * (25 - (5 - DXF_CURVE_TOLERANCE_MM) ** 2),
      );
      expect(distance(c.points[0], c.points.at(-1)!)).toBeGreaterThan(0);
      const project = newProject();
      project.material.tabCount = 0;
      project.parts = [{ ...part, cut: "centerline" }];
      expect(() => projectSchema.parse(project)).not.toThrow();
      const preview = plan(project);
      expect(preview.issues).toEqual([]);
      expect(Math.abs(preview.cutLength - (200 + 10 * Math.PI))).toBeLessThan(
        0.3,
      );
    });
  }
  it("preserves major arcs larger than a semicircle", () => {
    const points = flattenDxfPolyline(
      [
        { x: 10, y: 0, bulge: Math.tan((3 * Math.PI) / 8) },
        { x: 0, y: -10 },
      ],
      false,
      1,
    );
    const b = bounds(points);
    expect(Math.abs(b.width - 20)).toBeLessThan(0.08);
    expect(Math.abs(b.height - 20)).toBeLessThan(0.08);
    expect(Math.abs(curveLength(points) - 15 * Math.PI)).toBeLessThan(0.2);
    expect(points.at(-1)).toEqual({ x: 0, y: -10 });
  });
  it("bounds chord error in millimetres even for inch drawings", () => {
    const source = document(
      polyline("LWPOLYLINE", [
        { x: 0, y: 0, bulge: 1 },
        { x: 2, y: 0 },
      ]),
      1,
    );
    const c = importDxf(source, "inch arc", "mm").contours[0];
    expect(bounds(c.points).width).toBeCloseTo(50.8, 10);
    for (let i = 1; i < c.points.length; i++) {
      const midpoint = {
        x: (c.points[i - 1].x + c.points[i].x) / 2,
        y: (c.points[i - 1].y + c.points[i].y) / 2,
      };
      expect(25.4 - distance(midpoint, { x: 25.4, y: 0 })).toBeLessThanOrEqual(
        0.080000001,
      );
    }
    expect(c.points.length).toBeGreaterThan(
      importDxf(
        document(
          polyline("LWPOLYLINE", [
            { x: 0, y: 0, bulge: 1 },
            { x: 2, y: 0 },
          ]),
        ),
        "mm arc",
      ).contours[0].points.length,
    );
  });
  it("keeps straight and nearly straight segments and ignores unused final open bulges", () => {
    expect(
      flattenDxfPolyline(
        [
          { x: 0, y: 0, bulge: 1e-12 },
          { x: 20, y: 0 },
          { x: 20, y: 10, bulge: 1 },
        ],
        false,
        1,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ]);
  });
  it("honors a negative Z extrusion instead of mirroring the arc incorrectly", () => {
    for (const type of ["LWPOLYLINE", "POLYLINE"] as const) {
      const c = importDxf(
        document(
          polyline(
            type,
            [
              { x: 0, y: 0, bulge: 1 },
              { x: 20, y: 0 },
            ],
            false,
            -1,
          ),
        ),
        "mirrored arc",
      ).contours[0];
      expect(c.points[0].x).toBeCloseTo(20, 10);
      expect(c.points.at(-1)!.x).toBeCloseTo(0, 10);
      expect(bounds(c.points).height).toBeGreaterThan(9.9);
    }
  });
  it("rejects ambiguous or unreasonably dense curves without silently dropping geometry", () => {
    expect(() =>
      flattenDxfPolyline(
        [
          { x: 0, y: 0, bulge: 1 },
          { x: 0, y: 0 },
        ],
        false,
        1,
      ),
    ).toThrow(/coincident endpoints/);
    expect(() =>
      flattenDxfPolyline(
        [
          { x: 0, y: 0, bulge: Infinity },
          { x: 20, y: 0 },
        ],
        false,
        1,
      ),
    ).toThrow(/invalid bulge/);
    expect(() =>
      flattenDxfPolyline(
        [
          { x: 0, y: 0, bulge: 1 },
          { x: 1e10, y: 0 },
        ],
        false,
        1,
      ),
    ).toThrow(/20,000 points/);
    const tilted = document(
      polyline("LWPOLYLINE", [
        { x: 0, y: 0, bulge: 1 },
        { x: 20, y: 0 },
      ]),
    ).replace("210\n0\n", "210\n1\n");
    expect(() => importDxf(tilted, "tilted")).toThrow(/tilted polyline/);
  });
});

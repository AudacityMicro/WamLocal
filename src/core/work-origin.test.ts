import { expect, it } from "vitest";
import { workOriginPoint, ORIGIN_ANCHORS, toWorkPoint } from "./work-origin";
import { makePart, rectangle } from "./model";
import { newJob, jobSchema, sheetProject } from "./job";
import { setPartQuantity } from "./job-ops";
it("anchors all nine positions to combined transformed placement bounds", () => {
  const parts = [
    makePart("A", [rectangle(20, 10)], 30, 40),
    { ...makePart("B", [rectangle(10, 5)], 100, 70), rotation: 90, scale: 2 },
  ];
  // A: 30..50,40..50. B: 90..100,70..90. Combined: 30..100,40..90.
  ORIGIN_ANCHORS.forEach((workOrigin, i) =>
    expect(
      workOriginPoint(
        {
          stock: { width: 460, height: 305 },
          workOrigin,
          workOriginReference: "parts",
        },
        parts,
      ),
    ).toEqual({ x: 30 + (i % 3) * 35, y: 40 + Math.floor(i / 3) * 25 }),
  );
  expect(
    toWorkPoint(
      {
        stock: { width: 460, height: 305 },
        workOrigin: "center-center",
        workOriginReference: "parts",
      },
      { x: 70, y: 70 },
      parts,
    ),
  ).toEqual({ x: 5, y: 5 });
  parts[0].x = 0;
  expect(
    workOriginPoint(
      { stock: { width: 460, height: 305 }, workOriginReference: "parts" },
      parts,
    ),
  ).toEqual({ x: 0, y: 40 });
});
it("falls back to the sheet on empty layouts and keeps sheet mode unchanged", () => {
  const sheet = {
    stock: { width: 100, height: 60 },
    workOrigin: "bottom-right" as const,
  };
  expect(
    workOriginPoint({ ...sheet, workOriginReference: "parts" }, []),
  ).toEqual({ x: 100, y: 60 });
  expect(workOriginPoint(sheet, [makePart("A", [rectangle()], 5, 5)])).toEqual({
    x: 100,
    y: 60,
  });
});
it("keeps a zero quantity definition while removing every placement, and saves the reference mode", () => {
  const base = newJob(),
    part = {
      ...makePart("A", [rectangle(20, 10)]),
      materialId: base.materials[0].id,
      quantity: 2,
    };
  const job = jobSchema.parse({
    ...base,
    parts: [part],
    sheets: [
      {
        ...base.sheets[0],
        workOriginReference: "parts",
        placements: [
          { id: "copy1", partId: part.id, x: 10, y: 10, rotation: 0, scale: 1 },
          { id: "copy2", partId: part.id, x: 50, y: 50, rotation: 0, scale: 1 },
        ],
      },
    ],
  });
  const next = setPartQuantity(job, part.id, 0);
  expect(next.parts).toHaveLength(1);
  expect(next.parts[0].quantity).toBe(0);
  expect(next.sheets[0].placements).toHaveLength(0);
  expect(sheetProject(next, next.sheets[0].id).parts).toHaveLength(0);
  expect(
    jobSchema.parse(JSON.parse(JSON.stringify(next))).sheets[0]
      .workOriginReference,
  ).toBe("parts");
});

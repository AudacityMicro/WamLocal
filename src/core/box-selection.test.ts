import { describe, it, expect } from "vitest";
import { makePart, rectangle, circle } from "./model";
import { boxSelectParts } from "./box-selection";

describe("sheet window and crossing selection", () => {
  const part = makePart(
    "plate",
    [
      rectangle(20, 20),
      {
        ...circle(4),
        points: circle(4).points.map((p) => ({ x: p.x + 6, y: p.y + 6 })),
        hole: true,
      },
    ],
    10,
    10,
  );
  it("requires the whole profile for a rightward window", () => {
    expect(boxSelectParts([part], { x: 9, y: 9 }, { x: 31, y: 31 })).toEqual([
      part.id,
    ]);
    expect(boxSelectParts([part], { x: 9, y: 9 }, { x: 29, y: 31 })).toEqual(
      [],
    );
  });
  it("selects boundary crossings, tangencies and enclosed material leftward", () => {
    for (const [start, end] of [
      [
        { x: 11, y: 0 },
        { x: 9, y: 40 },
      ],
      [
        { x: 10, y: 12 },
        { x: 8, y: 14 },
      ],
      [
        { x: 15, y: 12 },
        { x: 12, y: 15 },
      ],
    ])
      expect(boxSelectParts([part], start, end)).toEqual([part.id]);
  });
  it("does not select empty holes or empty corners of curved bounds", () => {
    expect(boxSelectParts([part], { x: 21, y: 19 }, { x: 19, y: 21 })).toEqual(
      [],
    );
    const ring = makePart("disc", [circle(10)], 20, 20);
    expect(boxSelectParts([ring], { x: 21, y: 20 }, { x: 20, y: 21 })).toEqual(
      [],
    );
  });
  it("handles rotated, scaled open paths without closing them", () => {
    const p = {
      ...makePart(
        "open",
        [
          {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
            closed: false,
            hole: false,
          },
        ],
        20,
        20,
      ),
      rotation: 90,
      scale: 2,
    };
    expect(boxSelectParts([p], { x: 22, y: 29 }, { x: 18, y: 31 })).toEqual([
      p.id,
    ]);
    expect(boxSelectParts([p], { x: 11, y: 29 }, { x: 9, y: 31 })).toEqual([]);
    expect(boxSelectParts([p], { x: -1, y: 19 }, { x: 21, y: 41 })).toEqual([
      p.id,
    ]);
  });
});

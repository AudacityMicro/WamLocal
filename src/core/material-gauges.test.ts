import { describe, it, expect } from "vitest";
import { gaugesFor, extendGaugeLibrary } from "./material-gauges";
import { defaultMaterial } from "./job";

describe("nominal aluminum sheet gauges", () => {
  it("matches the aluminum column of the cited McNICHOLS sheet-stock chart", () => {
    const expected = [
      [8, 0.125],
      [10, 0.1],
      [12, 0.08],
      [14, 0.063],
      [16, 0.05],
      [18, 0.04],
      [20, 0.032],
      [22, 0.025],
      [24, 0.02],
    ];
    const actual = gaugesFor("Aluminum - 6061");
    for (const [gauge, inches] of expected) {
      const size = actual.find((g) => g.gauge === gauge)!;
      expect(size.inches).toBe(inches);
      expect(size.mm).toBeCloseTo(inches * 25.4, 8);
    }
  });
  it("regenerates obsolete automatic gauges and preserves edited defaults", () => {
    const base = {
      ...defaultMaterial("pro"),
      id: "aluminum",
      name: "Aluminum - 6061",
      stockKey: "Aluminum - 6061",
      thickness: 3.175,
    };
    const automaticId = "gauge-pro-Aluminum___6061-16";
    const editedId = "gauge-pro-Aluminum___6061-14";
    const library = extendGaugeLibrary({
      version: 1,
      materials: [
        base,
        {
          ...base,
          id: automaticId,
          thickness: 0.0508 * 25.4,
          source: "US nominal gauge thickness",
        },
        {
          ...base,
          id: editedId,
          thickness: 1.61,
          source: "User-edited defaults",
        },
      ],
    });
    expect(
      library.materials.find((m) => m.id === automaticId)?.thickness,
    ).toBeCloseTo(1.27, 8);
    expect(library.materials.find((m) => m.id === editedId)?.thickness).toBe(
      1.61,
    );
    expect(base.thickness).toBe(3.175);
  });
});

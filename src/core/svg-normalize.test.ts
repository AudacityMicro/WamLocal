// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { prepareSvg } from "./svg-normalize";
const svg = (s: string) => `<svg xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
describe("SVG compatibility", () => {
  it("accepts defs, gradients and editor metadata without making unused geometry cuttable", () => {
    const root = prepareSvg(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient><text>unused text</text></defs><metadata>editor</metadata><rect width="10" height="20" fill="url(#g)"/>',
      ),
    );
    expect(root.querySelector("rect")).not.toBeNull();
    expect(root.querySelector("metadata")).toBeNull();
    expect(root.querySelector("text")).toBeNull();
  });
  it("expands forward and nested local use references with transforms", () => {
    const root = prepareSvg(
      svg(
        '<use href="#plate" x="7" y="8"/><defs><g id="plate"><use href="#shape"/></g><rect id="shape" width="20" height="10"/></defs>',
      ),
    );
    expect(root.querySelector("use")).toBeNull();
    expect(root.firstElementChild?.getAttribute("transform")).toContain(
      "translate(7,8)",
    );
    expect(root.firstElementChild?.querySelector("rect")).not.toBeNull();
  });
  it("allows standard doctype and rejects cycles, missing references, external fetches and visible non-vector artwork", () => {
    expect(() =>
      prepareSvg(
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' +
          svg('<rect width="1" height="1"/>'),
      ),
    ).not.toThrow();
    expect(() =>
      prepareSvg(
        svg('<defs><g id="a"><use href="#a"/></g></defs><use href="#a"/>'),
      ),
    ).toThrow(/circular/);
    expect(() => prepareSvg(svg('<use href="#missing"/>'))).toThrow(/missing/);
    expect(() =>
      prepareSvg(svg('<use href="https://example.com/a.svg#shape"/>')),
    ).toThrow(/same file/);
    expect(() => prepareSvg(svg("<text>Lettering</text>"))).toThrow(/outlines/);
    expect(() =>
      prepareSvg(svg('<rect style="fill:url(https://example.com/image)"/>')),
    ).toThrow(/External/);
  });
});

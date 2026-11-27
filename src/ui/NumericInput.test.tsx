// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NumericInput } from "./NumericInput";
import {
  LengthInput,
  AreaInput,
  DisplayUnitsContext,
  unitFormat,
} from "./display-units";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function type(input: HTMLInputElement, text: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("numeric editing", () => {
  it("commits expressions on Enter, converts typed units and rejects fractional quantities", async () => {
    const changes = vi.fn();
    function Harness() {
      const [v, set] = useState(10);
      return (
        <LengthInput
          aria-label="Length"
          value={v}
          onChange={(n) => {
            changes(n);
            set(n);
          }}
        />
      );
    }
    await act(async () => root.render(<Harness />));
    const input = host.querySelector("input")!;
    await act(async () => input.focus());
    await type(input, "1/8 in");
    expect(changes).not.toHaveBeenCalled();
    expect(input.value).toBe("1/8 in");
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(changes).toHaveBeenLastCalledWith(3.175);
    expect(input.value).toBe("3.175");
    await act(async () => input.focus());
    await type(input, "2+3*4");
    await act(async () => input.blur());
    expect(changes).toHaveBeenLastCalledWith(14);
    await act(async () => input.focus());
    await type(input, "2");
    await type(input, "2/0");
    await act(async () => input.blur());
    expect(changes).toHaveBeenLastCalledWith(14);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.title).toContain("zero");
    await act(async () =>
      root.render(<NumericInput value={2} integer onChange={changes} />),
    );
    const quantity = host.querySelector("input")!;
    await act(async () => quantity.focus());
    await type(quantity, "3/2");
    await act(async () => quantity.blur());
    expect(changes).toHaveBeenLastCalledWith(14);
    expect(quantity.getAttribute("aria-invalid")).toBe("true");
  });
  it("converts explicit metric input while displaying inches and square inches", async () => {
    const length = vi.fn(),
      area = vi.fn();
    await act(async () =>
      root.render(
        <DisplayUnitsContext.Provider value={unitFormat("in")}>
          <LengthInput value={0} onChange={length} />
          <AreaInput value={0} onChange={area} />
        </DisplayUnitsContext.Provider>,
      ),
    );
    const inputs = host.querySelectorAll("input");
    await act(async () => inputs[0].focus());
    await type(inputs[0], "25.4mm");
    await act(async () => inputs[1].focus());
    expect(length).toHaveBeenLastCalledWith(25.4);
    await type(inputs[1], "2in*3in");
    await act(async () => inputs[1].blur());
    expect(area.mock.calls.at(-1)![0]).toBeCloseTo(6 * 25.4 ** 2);
  });
  it("preserves a leading decimal, a minus sign and trailing zeros while committing valid values", async () => {
    const changes: number[] = [];
    function Harness() {
      const [value, set] = useState(1);
      return (
        <NumericInput
          aria-label="Stock to leave"
          value={value}
          min={-10}
          max={10}
          step={0.05}
          onChange={(n) => {
            changes.push(n);
            set(n);
          }}
        />
      );
    }
    await act(() => root.render(<Harness />));
    const input = host.querySelector("input")!;
    await act(() => input.focus());
    await type(input, "");
    await type(input, ".");
    expect(input.value).toBe(".");
    expect(changes).toEqual([]);
    await type(input, ".005");
    expect(input.value).toBe(".005");
    expect(changes.at(-1)).toBe(0.005);
    await type(input, ".0050");
    expect(input.value).toBe(".0050");
    await type(input, "-");
    expect(input.value).toBe("-");
    await type(input, "-.005");
    expect(changes.at(-1)).toBe(-0.005);
    await act(() => input.blur());
    expect(input.value).toBe("-0.005");
  });
  it("rejects invalid and out-of-range models, restores incomplete drafts on blur, and supports escape", async () => {
    const change = vi.fn();
    await act(() =>
      root.render(
        <NumericInput value={2} min={0} max={10} onChange={change} />,
      ),
    );
    const input = host.querySelector("input")!;
    await act(() => input.focus());
    for (const text of [".", "-", "NaN", "Infinity", "11", "-1"])
      await type(input, text);
    expect(change).not.toHaveBeenCalled();
    await act(() => input.blur());
    expect(input.value).toBe("2");
    await act(() => input.focus());
    await type(input, ".005");
    await act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(change.mock.calls.map((c) => c[0])).toEqual([0.005, 2]);
    expect(input.value).toBe("2");
  });
  it("converts small inch lengths and square-inch areas without losing the typed decimal", async () => {
    function Harness() {
      const [length, setLength] = useState(1),
        [area, setArea] = useState(1);
      return (
        <DisplayUnitsContext.Provider value={unitFormat("in")}>
          <LengthInput
            aria-label="Length"
            value={length}
            onChange={setLength}
          />
          <AreaInput aria-label="Area" value={area} onChange={setArea} />
          <output>
            {length}|{area}
          </output>
        </DisplayUnitsContext.Provider>
      );
    }
    await act(() => root.render(<Harness />));
    const [length, area] = [...host.querySelectorAll("input")];
    await act(() => length.focus());
    await type(length, ".");
    await type(length, ".005");
    expect(length.value).toBe(".005");
    await act(() => area.focus());
    await type(area, ".005");
    expect(host.querySelector("output")!.textContent).toBe(
      `${0.005 * 25.4}|${0.005 * 25.4 * 25.4}`,
    );
  });
});

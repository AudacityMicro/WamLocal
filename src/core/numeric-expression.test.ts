import { it, expect } from "vitest";
import { evaluateNumericExpression as calc } from "./numeric-expression";
it("evaluates arithmetic, precedence, fractions, functions and scientific notation", () => {
  expect(calc("(2+3)*4-6/2")).toBe(17);
  expect(calc("-2^2")).toBe(-4);
  expect(calc("2^3^2")).toBe(512);
  expect(calc("sqrt(9)+abs(-2)")).toBe(5);
  expect(calc("max(2,3)+min(4,5)")).toBe(7);
  expect(calc("1e-3*5")).toBe(0.005);
  expect(calc("pi*2")).toBeCloseTo(Math.PI * 2);
  expect(calc("1 1/2 in", "mm")).toBeCloseTo(38.1);
});
it("converts compatible lengths and mixed-unit arithmetic into display units", () => {
  expect(calc("1/8 in", "mm")).toBeCloseTo(3.175);
  expect(calc("25.4 mm", "in")).toBeCloseTo(1);
  expect(calc("1 in + 2 mm", "mm")).toBeCloseTo(27.4);
  expect(calc("1 in + 2", "mm")).toBeCloseTo(27.4);
  expect(calc("2*(1 in + 5mm)", "mm")).toBeCloseTo(60.8);
  expect(calc("5 thou", "in")).toBeCloseTo(0.005);
  expect(calc('12"', "ft")).toBeCloseTo(1);
  expect(calc("1 in / 2 in")).toBeCloseTo(0.5);
});
it("converts areas, rates, time, angles and percentages without mixing dimensions", () => {
  expect(calc("2in * 3in", "mm^2")).toBeCloseTo(6 * 25.4 ** 2);
  expect(calc("645.16 mm²", "in^2")).toBeCloseTo(1);
  expect(calc("1 sq in", "mm²")).toBeCloseTo(645.16);
  expect(calc("1 in/s", "mm/min")).toBeCloseTo(1524);
  expect(calc("1 min + 30 s", "s")).toBe(90);
  expect(calc("0.5 lb/min", "g/min")).toBeCloseTo(226.796185);
  expect(calc("1.16845/kg", "1/lb")).toBeCloseTo(0.53, 4);
  expect(calc("pi rad", "deg")).toBeCloseTo(180);
  expect(calc("50% * 10mm", "mm")).toBeCloseTo(5);
  expect(calc("25%+25%", "%")).toBeCloseTo(50);
  expect(calc("round(30mm)", "in")).toBe(1);
});
it("rejects invalid, nonfinite, mismatched and executable input", () => {
  for (const source of [
    "1/0",
    "sqrt(-1)",
    "2+",
    "(2+3",
    "1;alert(1)",
    "constructor",
    "globalThis",
    "NaN",
    "Infinity",
    "1e999",
    "2 3",
    "2**3",
    "a".repeat(513),
  ])
    expect(() => calc(source)).toThrow();
  expect(() => calc("1 in + 1 sec", "mm")).toThrow();
  expect(() => calc("2in", "mm^2")).toThrow("compatible");
  expect(() => calc("2in")).toThrow("physical units");
});

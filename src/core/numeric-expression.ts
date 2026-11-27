/** Small dimensional calculator. No eval, JavaScript execution or external access. */
type Dimension = [number, number, number, number]; // length (mm), time (s), mass (g), angle (deg)
type Quantity = { value: number; dim: Dimension };
const scalar: Dimension = [0, 0, 0, 0];
const same = (a: Dimension, b: Dimension) =>
  a.every((n, i) => Math.abs(n - b[i]) < 1e-9);
const bare = (q: Quantity) => same(q.dim, scalar);
const q = (value: number, dim: Dimension = scalar): Quantity => ({
  value,
  dim,
});
const units: Record<string, Quantity> = Object.create(null);
function define(names: string[], value: number, dim: Dimension) {
  for (const name of names) units[name] = q(value, dim);
}
define(
  ["mm", "millimeter", "millimeters", "millimetre", "millimetres"],
  1,
  [1, 0, 0, 0],
);
define(
  ["cm", "centimeter", "centimeters", "centimetre", "centimetres"],
  10,
  [1, 0, 0, 0],
);
define(["m", "meter", "meters", "metre", "metres"], 1000, [1, 0, 0, 0]);
define(["in", "inch", "inches", '"'], 25.4, [1, 0, 0, 0]);
define(["ft", "foot", "feet", "'"], 304.8, [1, 0, 0, 0]);
define(["yd", "yard", "yards"], 914.4, [1, 0, 0, 0]);
define(["mil", "mils", "thou"], 0.0254, [1, 0, 0, 0]);
define(["um", "µm", "μm", "micron", "microns"], 0.001, [1, 0, 0, 0]);
define(["s", "sec", "secs", "second", "seconds"], 1, [0, 1, 0, 0]);
define(["ms"], 0.001, [0, 1, 0, 0]);
define(["min", "mins", "minute", "minutes"], 60, [0, 1, 0, 0]);
define(["h", "hr", "hrs", "hour", "hours"], 3600, [0, 1, 0, 0]);
define(["g", "gram", "grams"], 1, [0, 0, 1, 0]);
define(["kg", "kilogram", "kilograms"], 1000, [0, 0, 1, 0]);
define(["lb", "lbs", "pound", "pounds"], 453.59237, [0, 0, 1, 0]);
define(["oz", "ounce", "ounces"], 28.349523125, [0, 0, 1, 0]);
define(["deg", "degree", "degrees", "°"], 1, [0, 0, 0, 1]);
define(["rad", "radian", "radians"], 180 / Math.PI, [0, 0, 0, 1]);
define(["%"], 0.01, scalar);
const finite = (result: Quantity) => {
  if (!Number.isFinite(result.value)) throw Error("Result must be finite.");
  return result;
};

function parse(source: string, target?: Quantity): Quantity {
  if (source.length > 512) throw Error("Expression is too long.");
  const text = source
    .toLowerCase()
    .replace(/[×·]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/([a-zµμ°]+)²/g, "$1^2")
    .replace(/([a-zµμ°]+)³/g, "$1^3")
    .replace(/\b(mm|cm|m|in|ft)([23])\b/g, "$1^$2")
    .replace(/\b(sq|square)\s+(mm|cm|m|in|ft)\b/g, "$2^2")
    .replace(/\b(\d+)\s+(\d+)\s*\/\s*(\d+)\b/g, "($1+$2/$3)");
  const tokens: string[] = [];
  const token =
    /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|([a-zµμ]+|π)|([+\-*/^(),%°"']))/gy;
  let pos = 0;
  while (pos < text.length) {
    if (!text.slice(pos).trim()) break;
    token.lastIndex = pos;
    const m = token.exec(text);
    if (!m) throw Error("Unrecognized number, unit or operator.");
    tokens.push(m[0].trim());
    pos = token.lastIndex;
  }
  let index = 0;
  const peek = () => tokens[index];
  const consume = () => tokens[index++];
  const add = (a: Quantity, b: Quantity, sign = 1) => {
    if (!same(a.dim, b.dim)) {
      if (target && bare(a) && same(b.dim, target.dim))
        a = q(a.value * target.value, target.dim);
      else if (target && bare(b) && same(a.dim, target.dim))
        b = q(b.value * target.value, target.dim);
      else throw Error("Cannot add values with different units.");
    }
    return finite(q(a.value + sign * b.value, a.dim));
  };
  function primary(): Quantity {
    const t = consume();
    if (!t) throw Error("Complete the expression.");
    if (t === "(") {
      const value = sum();
      if (consume() !== ")") throw Error("Missing closing parenthesis.");
      return value;
    }
    if (t === "pi" || t === "π") return q(Math.PI);
    if (t === "e") return q(Math.E);
    if (units[t] && !(t === "min" && peek() === "(")) return { ...units[t] };
    if (["sqrt", "abs", "round", "floor", "ceil", "min", "max"].includes(t)) {
      if (consume() !== "(") throw Error("Functions need parentheses.");
      const args = [sum()];
      while (peek() === ",") {
        consume();
        args.push(sum());
      }
      if (consume() !== ")") throw Error("Missing closing parenthesis.");
      if (t === "min" || t === "max") {
        if (args.some((a) => !same(a.dim, args[0].dim)))
          throw Error("Function arguments need matching units.");
        return q(Math[t](...args.map((a) => a.value)), args[0].dim);
      }
      if (args.length !== 1) throw Error("Function needs one argument.");
      const a = args[0];
      if (t === "sqrt")
        return finite(
          q(Math.sqrt(a.value), a.dim.map((n) => n / 2) as Dimension),
        );
      // Rounding uses displayed units, rather than canonical mm/seconds/grams.
      const scale = target && same(a.dim, target.dim) ? target.value : 1;
      return q(
        Math[t as "abs" | "round" | "floor" | "ceil"](a.value / scale) * scale,
        a.dim,
      );
    }
    if (/^\d|^\./.test(t)) return finite(q(Number(t)));
    throw Error(`Unknown unit or function: ${t}`);
  }
  function power(): Quantity {
    let a = primary();
    if (peek() === "^") {
      consume();
      const b = unary();
      if (!bare(b) || Math.abs(b.value) > 12) throw Error("Invalid exponent.");
      a = finite(
        q(a.value ** b.value, a.dim.map((n) => n * b.value) as Dimension),
      );
    }
    return a;
  }
  function unary(): Quantity {
    if (peek() === "+" || peek() === "-") {
      const negative = consume() === "-",
        a = unary();
      return q(negative ? -a.value : a.value, a.dim);
    }
    return power();
  }
  function product(): Quantity {
    let a = unary();
    while (
      peek() === "*" ||
      peek() === "/" ||
      peek() === "(" ||
      !!units[peek()]
    ) {
      const op = peek() === "*" || peek() === "/" ? consume() : "*";
      let b = unary();
      // In a dimensional ratio, keep denominator units with their number.
      // Bare fractions such as 1/8 in still mean (1/8) inches.
      if (op === "/" && !bare(a) && bare(b))
        while (units[peek()]) {
          const unit = power();
          b = q(
            b.value * unit.value,
            b.dim.map((n, i) => n + unit.dim[i]) as Dimension,
          );
        }
      if (op === "/" && b.value === 0) throw Error("Cannot divide by zero.");
      a = finite(
        q(
          op === "/" ? a.value / b.value : a.value * b.value,
          a.dim.map(
            (n, i) => n + (op === "/" ? -b.dim[i] : b.dim[i]),
          ) as Dimension,
        ),
      );
    }
    return a;
  }
  function sum(): Quantity {
    let a = product();
    while (peek() === "+" || peek() === "-") {
      const sign = consume() === "+" ? 1 : -1;
      a = add(a, product(), sign);
    }
    return a;
  }
  const result = finite(sum());
  if (index !== tokens.length)
    throw Error("Unexpected input after expression.");
  return result;
}

/** Result is in the field's display units. Bare numbers already use those units. */
export function evaluateNumericExpression(
  source: string,
  unit?: string,
): number {
  const target = unit ? parse(unit) : undefined,
    result = parse(source, target);
  if (bare(result)) {
    // A percent suffix is a physical ratio; bare entries in a % field are percentages.
    return unit === "%" && source.includes("%")
      ? result.value / 0.01
      : result.value;
  }
  if (!target || !same(result.dim, target.dim))
    throw Error(
      unit
        ? `Use units compatible with ${unit}.`
        : "This setting does not accept physical units.",
    );
  return finite(q(result.value / target.value)).value;
}

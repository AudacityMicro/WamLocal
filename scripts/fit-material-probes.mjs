import { readFile } from "node:fs/promises";
const samples = JSON.parse(
  await readFile("fixtures/wam-reference/materials/samples.json", "utf8"),
);
function solve(a, b) {
  a = a.map((r, i) => [...r, b[i]]);
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let r = c;
    for (let i = c + 1; i < n; i++)
      if (Math.abs(a[i][c]) > Math.abs(a[r][c])) r = i;
    [a[c], a[r]] = [a[r], a[c]];
    if (Math.abs(a[c][c]) < 1e-12) return null;
    let v = a[c][c];
    for (let j = c; j <= n; j++) a[c][j] /= v;
    for (let i = 0; i < n; i++)
      if (i !== c) {
        let f = a[i][c];
        for (let j = c; j <= n; j++) a[i][j] -= f * a[c][j];
      }
  }
  return a.map((r) => r[n]);
}
function fit(rows, features, log) {
  const xs = rows.map((r) => features(r.x)),
    ys = rows.map((r) => (log ? Math.log(r.y) : r.y)),
    n = xs[0].length;
  return solve(
    Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) =>
        xs.reduce((s, x) => s + x[i] * x[j], 0),
      ),
    ),
    Array.from({ length: n }, (_, i) =>
      xs.reduce((s, x, j) => s + x[i] * ys[j], 0),
    ),
  );
}
const models = {
  inverse2: { f: (x) => [1, x, x * x], log: false, inv: true },
  inverse3: { f: (x) => [1, x, x * x, x ** 3], log: false, inv: true },
  inverse4: { f: (x) => [1, x, x * x, x ** 3, x ** 4], log: false, inv: true },
  logPoly2: { f: (x) => [1, Math.log(x), Math.log(x) ** 2], log: true },
  logPoly3: {
    f: (x) => [1, Math.log(x), Math.log(x) ** 2, Math.log(x) ** 3],
    log: true,
  },
  quartic: { f: (x) => [1, x, x * x, x * x * x, x ** 4], log: false },
  power: { f: (x) => [1, Math.log(x)], log: true },
  powerExp: { f: (x) => [1, Math.log(x), x], log: true },
  powerExp2: { f: (x) => [1, Math.log(x), x, x * x], log: true },
  quadratic: { f: (x) => [1, x, x * x], log: false },
  cubic: { f: (x) => [1, x, x * x, x * x * x], log: false },
  logLinear: { f: (x) => [1, Math.log(x)], log: false },
};
for (const index of [0, 8, 23]) {
  const data = samples
    .filter((s) => s.materialIndex === index)
    .sort((a, b) => a.thicknessIn - b.thicknessIn);
  for (const field of ["feed", "tab", "lead", "pierce"]) {
    let rows = data.map((s) => ({
      x: Math.max(0.03, Math.round(s.thicknessMm * 100) / 100),
      y:
        field === "feed"
          ? s.data.speedMode.roughRate.value
          : field === "tab"
            ? s.data.defaultTabWidth.value
            : field === "lead"
              ? s.data.defaultLeadDist.value
              : s.data.pierceTime.value,
    }));
    if (field === "feed") rows = rows.filter((r) => r.y < 1500);
    if (field === "lead") rows = rows.filter((r) => r.y > 0.72);
    if (field === "pierce") rows = rows.filter((r) => r.y > 1);
    const results = [];
    for (const [name, m] of Object.entries(models)) {
      if (rows.length <= m.f(1).length) continue;
      const c = fit(
        m.inv ? rows.map((r) => ({ ...r, y: 1 / r.y })) : rows,
        m.f,
        m.log,
      );
      if (!c) continue;
      let max = 0;
      for (const r of rows) {
        const v = c.reduce((s, c, i) => s + c * m.f(r.x)[i], 0);
        max = Math.max(
          max,
          Math.abs((m.log ? Math.exp(v) : m.inv ? 1 / v : v) - r.y),
        );
      }
      results.push({
        model: name,
        error: Number(max.toFixed(4)),
        coeff: c.map((v) => Number(v.toPrecision(9))),
      });
    }
    results.sort((a, b) => a.error - b.error);
    console.log(index, field, JSON.stringify(results.slice(0, 2)));
  }
}

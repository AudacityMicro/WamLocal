import fs from "node:fs";
import DxfParser from "dxf-parser";
import { importDxf } from "../src/core/import";
import { area, bounds, plan } from "../src/core/geometry";
import { newProject } from "../src/core/model";
const source = fs.readFileSync("C:/Users/AJ/Downloads/Shim.dxf", "utf8");
const data = new DxfParser().parseSync(source)!;
const types: Record<string, number> = {};
for (const e of data.entities) types[e.type] = (types[e.type] ?? 0) + 1;
const part = importDxf(source, "Shim.dxf");
const project = newProject();
project.material = { ...project.material, kerf: 0.9652, tabCount: 0, lead: 0 };
project.parts = [{ ...part, x: 20, y: 20 }];
const paths = plan(project);
console.log(
  JSON.stringify(
    {
      types,
      cut: part.cut,
      contours: part.contours.map((c, i) => ({
        i,
        closed: c.closed,
        hole: c.hole,
        points: c.points.length,
        area: area(c.points),
        bounds: bounds(c.points),
        first: c.points[0],
        last: c.points.at(-1),
      })),
      planned: paths.contourPlans.map((c) => ({
        hole: c.contour.hole,
        area: area(c.contour.points),
        bounds: bounds(c.contour.points),
      })),
      issues: paths.issues,
    },
    null,
    2,
  ),
);
fs.writeFileSync("artifacts/shim-after.json", JSON.stringify(part, null, 2));

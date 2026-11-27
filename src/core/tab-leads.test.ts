import { describe, it, expect } from "vitest";
import { makePart, newProject, rectangle, circle, type Point } from "./model";
import { planForPosting, postJob } from "./postprocessor";
import { curvedLead } from "./lead-in";
import { movePathStart } from "./path-math";
import { tabLeadsClear } from "./tab-leads";
import { distance, plan } from "./geometry";
import { readJob } from "./job";
import { inspectReferenceNc } from "./nc-inspect";
import ClipperLib from 'clipper-lib';
function fixture(hole = false, reversed = false, width = 0.254) {
  const p = newProject();
  p.tabRules = undefined;
  p.machineSettings = undefined;
  p.material = {
    ...p.material,
    lead: 2,
    leadStyle: "arc",
    kerf: 0.9652,
    pierceDiameter: 0,
    tabWidth: width,
    tabCount: 1,
    cornerSlowdown: false,
  };
  const c = hole
    ? {
        ...circle(5),
        hole: true,
        points: circle(5).points.map((p) => ({ x: p.x + 30, y: p.y + 25 })),
      }
    : rectangle(60, 40);
  if (reversed) c.points.reverse();
  p.parts = [
    makePart(
      "tabbed",
      [
        ...(hole
          ? [{ ...rectangle(60, 50), tabMode: "none" as const, lead: 0 }]
          : []),
        { ...c, tabMode: "manual", tabs: [{ position: 0.15, width }] },
      ],
      40,
      40,
    ),
  ];
  return p;
}
const same = (a: Point, b: Point) => distance(a, b) < 1e-7;
function leads(preview: ReturnType<typeof planForPosting>, hole: boolean) {
  const cp = preview.contourPlans.find((cp) => cp.contour.hole === hole)!;
  const gaps = preview.moves.filter(
    (m) => m.kind === "tab" && m.partId === cp.partId,
  );
  // This fixture has one nonwrapped tab. Curved boundaries can split the gap.
  const op = preview.operations.find(
    (op) => op.contourIndex === cp.contourIndex,
  )!;
  const after = op.entry;
  let before = after;
  const used = new Set<number>();
  while (true) {
    const i = gaps.findIndex((m, i) => !used.has(i) && same(m.to, before));
    if (i < 0) break;
    used.add(i);
    before = gaps[i].from;
  }
  const enter = op.moves.findIndex((m) => same(m.to, after)),
    exit = op.moves.findIndex((m) => same(m.from, before));
  expect(enter).toBeGreaterThanOrEqual(0);
  expect(exit).toBeGreaterThanOrEqual(0);
  return {
    entry: [op.start, ...op.moves.slice(0, enter + 1).map((m) => m.to)],
    exit: [before, ...op.moves.slice(exit).map((m) => m.to)],
  };
}
it("reproduces the original tangent arcs intersecting across a narrow tab", () => {
  const p = fixture(),
    cp = plan(p).contourPlans[0],
    gap = cp.moves.filter((m) => m.kind === "tab");
  const at = (point: Point) => ({
    ...cp.contour,
    points: movePathStart(cp.contour.points, point),
  });
  const out = curvedLead(at(gap[0].from), 2, true, false),
    entry = curvedLead(at(gap.at(-1)!.to), 2, false, false);
  expect(tabLeadsClear(out, entry, 0.9652, 0.9652, 0.254)).toBe(false);
});
it('keeps the part connected to the stock after independently subtracting the swept kerf',()=>{
  const p=fixture(),base=plan(p).contourPlans[0],gap=base.moves.filter(m=>m.kind==='tab');
  const before=gap[0].from,after=gap.at(-1)!.to;
  const at=(point:Point)=>({...base.contour,points:movePathStart(base.contour.points,point)});
  const cuts=base.moves.slice(2),start=cuts.findIndex(m=>same(m.from,after));
  const oldPath=[...curvedLead(at(after),2,false,false),...[...cuts.slice(start),...cuts.slice(0,start)].filter(m=>m.kind==='cut').map(m=>m.to),...curvedLead(at(before),2,true,false).slice(1)];
  const corrected=planForPosting(p),op=corrected.operations[0],newPath=[op.start,...op.moves.map(m=>m.to)];
  const connected=(path:Point[])=>{
    const scale=10000,offset=new ClipperLib.ClipperOffset(2,.001*scale),swept=new ClipperLib.Paths();
    offset.AddPath(path.map(p=>({X:Math.round(p.x*scale),Y:Math.round(p.y*scale)})),ClipperLib.JoinType.jtRound,ClipperLib.EndType.etOpenRound);offset.Execute(swept,p.material.kerf*scale/2);
    const clip=new ClipperLib.Clipper(),tree=new ClipperLib.PolyTree();
    clip.AddPath([{X:0,Y:0},{X:460*scale,Y:0},{X:460*scale,Y:305*scale},{X:0,Y:305*scale}],ClipperLib.PolyType.ptSubject,true);
    clip.AddPaths(swept,ClipperLib.PolyType.ptClip,true);clip.Execute(ClipperLib.ClipType.ctDifference,tree,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero);
    const components:any[]=[];
    const visit=(node:any)=>{if(node.Contour().length&&!node.IsHole())components.push(node);for(const child of node.Childs())visit(child)};visit(tree);
    const component=(point:Point)=>components.findIndex(node=>ClipperLib.Clipper.PointInPolygon({X:point.x*scale,Y:point.y*scale},node.Contour())!==0 && !node.Childs().some((hole:any)=>ClipperLib.Clipper.PointInPolygon({X:point.x*scale,Y:point.y*scale},hole.Contour())!==0));
    return component({x:5,y:5})===component({x:70,y:60});
  };
  expect(connected(oldPath)).toBe(false);expect(connected(newPath)).toBe(true);
});
describe("finished bridges between tangent leads", () => {
  it('does not join small-hole tab leads at a shared centroid',()=>{
    const p=fixture(true),small=circle(1.5);p.parts[0].contours[1].points=small.points.map(p=>({x:p.x+30,y:p.y+25}));
    const preview=planForPosting(p),paths=leads(preview,true);
    expect(tabLeadsClear(paths.exit,paths.entry,.9652,.9652,.254)).toBe(true);
    expect(distance(paths.entry[0],paths.exit.at(-1)!)).toBeGreaterThan(1.219);
    expect(preview.issues.filter(s=>/clearance cannot/.test(s))).toEqual([]);
    expect(()=>postJob(readJob(p))).not.toThrow();
  });
  it("blocks an impossible bridge instead of silently cutting away the tab", () => {
    const p = fixture(true, false, 12);
    expect(() => postJob(readJob(p))).toThrow(/Retaining tab clearance/);
  });
  it.each([false, true])(
    "preserves outer/hole tabs for hole=%s in either winding and both default width limits",
    (hole) => {
      for (const reversed of [false, true])
        for (const width of [0.254, 1.016]) {
          const p = fixture(hole, reversed, width),
            preview = planForPosting(p),
            paths = leads(preview, hole);
          expect(
            preview.issues.filter((s) =>
              /clearance cannot|entire contour/.test(s),
            ),
          ).toEqual([]);
          expect(
            tabLeadsClear(paths.exit, paths.entry, 0.9652, 0.9652, width),
          ).toBe(true);
          expect(paths.entry.length).toBeGreaterThan(2); // Tangent arcs remain arcs.
        }
    },
  );
  it("keeps overlap out of a retaining bridge and posts the same protected preview", () => {
    const p = fixture();
    p.material.leadInOverlap = 1;
    p.material.leadOutOverlap = 1;
    const preview = planForPosting(p),
      paths = leads(preview, false);
    expect(tabLeadsClear(paths.exit, paths.entry, 0.9652, 0.9652, 0.254)).toBe(
      true,
    );
    const files = postJob(readJob(p));
    expect(files).toHaveLength(1);
    expect(files[0].operations).toBe(1);
    const emitted = inspectReferenceNc(files[0].content).moves.filter(
      (m) => !m.rapid,
    );
    const entry = [
      emitted[0].from,
      ...emitted.slice(0, paths.entry.length - 1).map((m) => m.to),
    ];
    const tail = emitted.slice(-(paths.exit.length - 1)),
      exit = [tail[0].from, ...tail.map((m) => m.to)];
    expect(tabLeadsClear(exit, entry, 0.9652, 0.9652, 0.254)).toBe(true);
  });
  it("handles wrapped corner tabs, automatic tabs and explicit entries without consuming bridges", () => {
    for (const mode of ["auto", "manual"] as const)
      for (const startPosition of [undefined, 0.27]) {
        const p = fixture(),
          c = p.parts[0].contours[0];
        c.tabMode = mode;
        c.startPosition = startPosition;
        c.tabs = [
          { position: 0, width: 0.254 },
          { position: 0.5, width: 0.508 },
        ];
        p.material.tabCount = 2;
        const preview = planForPosting(p);
        expect(
          preview.issues.filter((s) =>
            /clearance cannot|entire contour/.test(s),
          ),
        ).toEqual([]);
        expect(preview.operations.length).toBeGreaterThanOrEqual(2);
        expect(postJob(readJob(p))[0].operations).toBe(
          preview.operations.length,
        );
      }
  });
});

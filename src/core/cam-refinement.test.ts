import { describe, it, expect } from "vitest";
import { rectangle, circle, makePart, newProject } from "./model";
import { bounds, offset, transformed, distance, plan } from "./geometry";
import { curvedLead } from "./lead-in";
import { scheduleCornerFeeds } from "./corner-feed";
import { pointInPaths, closestOnPath } from "./path-math";
import { planForPosting } from "./postprocessor";
import { comparePostedReference } from "../../scripts/compare-wam-posting";

describe("physical tab widths", () => {
  it.each([0, 0.9652, 1.1])("adds kerf %s to both hole and outer automatic gaps", kerf => {
    const p = newProject();
    p.material = { ...p.material, kerf, tabWidth: 2, tabCount: 2, lead: 0 };
    p.parts = [makePart("plate", [rectangle(60, 40), { ...circle(8), hole: true }], 30, 30)];
    for (const cp of plan(p).contourPlans) {
      const gap = cp.moves.filter(m => m.kind === "tab").reduce((n, m) => n + distance(m.from, m.to), 0);
      expect(gap).toBeCloseTo(2 * (2 + kerf), 5);
    }
    p.parts[0].contours[1].tabMode = "none";
    expect(plan(p).contourPlans.find(cp => cp.contour.hole)!.moves.some(m => m.kind === "tab")).toBe(false);
  });
  it.each(["cmp020t", "cmp020i", "plate-hole-valid"])("matches WAM gap totals and operation counts for %s", async name => {
    const r = await comparePostedReference(name);
    expect(r.local.segments).toBe(r.wam.segments);
    expect(r.summary.localGaps.reduce((n, g) => n + g.gapMm, 0)).toBeCloseTo(r.summary.wamGaps.reduce((n: number, g: { gapMm: number }) => n + g.gapMm, 0), 5);
  });
});

describe("bounded geometric compensation", () => {
  it.each([0, 1, 30, 47, 90, 133])("keeps the physical offset at rotation %s", rotation => {
    const contour = transformed({ ...makePart("rect", [rectangle(60, 40)], 30, 30), rotation, scale: 0.75 })[0];
    const compensated = offset(contour, 0.4826)[0];
    for (const point of compensated.points) expect(Math.abs(closestOnPath(contour.points, true, point).distance - 0.4826)).toBeLessThan(0.0002);
    const a = rotation * Math.PI / 180;
    expect(bounds(compensated.points).width).toBeCloseTo(45 * Math.abs(Math.cos(a)) + 30 * Math.abs(Math.sin(a)) + 0.9652, 2);
    expect(bounds(compensated.points).height).toBeCloseTo(45 * Math.abs(Math.sin(a)) + 30 * Math.abs(Math.cos(a)) + 0.9652, 2);
  });
});

describe("tangent scrap-side leads", () => {
  it.each(["auto", "none", "manual"] as const)("retains entry leads with tab mode %s and zero automatic tabs", tabMode=>{
    const p=newProject();
    p.material={...p.material,tabCount:0,lead:2,leadStyle:"straight",cornerSlowdown:false};
    p.parts=[makePart("no tabs",[{...rectangle(40,40),tabMode,tabs:[]}],30,30)];
    const posted=planForPosting(p);
    expect(posted.operations).toHaveLength(1);
    const contour=posted.contourPlans[0].contour;
    expect(distance(posted.operations[0].moves[0].from,contour.points[0])).toBeCloseTo(2,4);
    expect(posted.moves.some(m=>m.kind==="tab")).toBe(false);
  });
  it.each([false, true])("keeps complete arc chords in scrap for hole=%s, either winding", hole => {
    for (const reversed of [false, true]) for (const exit of [false, true]) {
      const contour = { ...circle(10), hole };
      if (reversed) contour.points.reverse();
      const lead = curvedLead(contour, 2, exit);
      expect(lead.length).toBeGreaterThan(5);
      const length = lead.slice(1).reduce((n, p, i) => n + distance(lead[i], p), 0);
      expect(length).toBeCloseTo(2, 2);
      for (let i = 1; i < lead.length; i++) for (const t of [0.1, 0.5, 0.9]) {
        expect(pointInPaths([contour.points], { x: lead[i - 1].x + t * (lead[i].x - lead[i - 1].x), y: lead[i - 1].y + t * (lead[i].y - lead[i - 1].y) })).toBe(hole);
      }
    }
  });
  it("shortens oversized arcs in tiny holes and preserves explicit straight/constant choices", () => {
    const contour = { ...circle(0.4), hole: true };
    const lead = curvedLead(contour, 20);
    expect(lead.slice(1).reduce((n, p, i) => n + distance(lead[i], p), 0)).toBeLessThan(1);
    const p = newProject(); p.material = { ...p.material, leadStyle: "straight", cornerSlowdown: false, tabCount: 0 };
    p.parts = [makePart("plate", [rectangle(40, 40)], 30, 30)];
    const posted = planForPosting(p);
    expect(posted.operations[0].moves.every(m => m.feed === p.material.feed)).toBe(true);
    expect(posted.operations[0].moves.length).toBeLessThan(100);
  });
});

describe("corner feed scheduling", () => {
  it("slows a right angle to the observed 45%, recovers with distance, and preserves geometry", () => {
    const moves = [{ from: { x: 0, y: 0 }, to: { x: 50, y: 0 }, kind: "cut" as const, partId: "p", feed: 100 }, { from: { x: 50, y: 0 }, to: { x: 50, y: 50 }, kind: "cut" as const, partId: "p", feed: 100 }];
    const result = scheduleCornerFeeds(moves, 100);
    expect(Math.min(...result.map(m => m.feed!))).toBeCloseTo(45, 5);
    expect(result[0].feed).toBe(100); expect(result.at(-1)!.feed).toBe(100);
    expect(result.reduce((n, m) => n + distance(m.from, m.to), 0)).toBeCloseTo(100, 8);
    expect(result.every(m => closestOnPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], false, m.to).distance < 1e-9)).toBe(true);
  });
});

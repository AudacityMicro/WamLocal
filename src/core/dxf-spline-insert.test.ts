import {describe,it,expect} from 'vitest';
import {importDxf} from './import';
import {evaluateDxfSpline,flattenDxfSpline,type DxfSpline} from './dxf-spline';
import {bounds,distance} from './geometry';

const doc=(entities:string,blocks='')=>`0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const block=(name:string,entities:string,x=0,y=0)=>`0\nBLOCK\n2\n${name}\n70\n0\n10\n${x}\n20\n${y}\n30\n0\n${entities}0\nENDBLK\n`;
const insert=(name:string,options='')=>`0\nINSERT\n2\n${name}\n10\n0\n20\n0\n30\n0\n${options}`;
const rectangle=`0\nLWPOLYLINE\n90\n4\n70\n1\n10\n10\n20\n20\n10\n12\n20\n20\n10\n12\n20\n21\n10\n10\n20\n21\n`;
const quarter:DxfSpline={degreeOfSplineCurve:2,knotValues:[0,0,0,1,1,1],controlPoints:[{x:10,y:0},{x:10,y:10},{x:0,y:10}],weights:[1,Math.SQRT1_2,1]};
const encoded=(s:DxfSpline)=>`0\nSPLINE\n70\n${(s.closed?1:0)|(s.periodic?2:0)|4}\n71\n${s.degreeOfSplineCurve}\n72\n${s.knotValues.length}\n73\n${s.controlPoints.length}\n${s.knotValues.map(k=>`40\n${k}\n`).join('')}${(s.weights??[]).map(w=>`41\n${w}\n`).join('')}${s.controlPoints.map(p=>`10\n${p.x}\n20\n${p.y}\n30\n${p.z??0}\n`).join('')}`;
function deviation(p:{x:number,y:number},points:{x:number,y:number}[]){return Math.min(...points.slice(1).map((b,i)=>{const a=points[i],dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}));}

describe('DXF splines and inserts',()=>{
  it('imports spline blocks and construction markers without routine conversion notices',()=>{
    const notices:string[]=[];
    const p=importDxf(doc(insert('curve')+'0\nPOINT\n10\n500\n20\n500\n',block('curve',encoded(quarter))),'curve','mm',message=>notices.push(message));
    expect(p.contours).toHaveLength(1);
    expect(p.contours[0].points.length).toBeGreaterThan(3);
    expect(notices).toEqual([]);
    expect(()=>importDxf(doc(insert('missing')),'broken','mm',message=>notices.push(message))).toThrow(/missing block/);
  });
  it('preserves rational weights through DXF parsing and traces a true quarter circle',()=>{
    expect(evaluateDxfSpline(quarter,.5)).toEqual({x:Math.SQRT1_2*10,y:Math.SQRT1_2*10});
    const points=flattenDxfSpline(quarter,1);
    for(let i=0;i<=1000;i++){const angle=i*Math.PI/2000;expect(deviation({x:10*Math.cos(angle),y:10*Math.sin(angle)},points)).toBeLessThanOrEqual(.080001);}
    const imported=importDxf(doc(encoded(quarter)),'weighted');
    expect(imported.contours[0].points.length).toBe(points.length);
    for(const p of imported.contours[0].points)expect(Math.hypot(p.x,10-p.y)).toBeCloseTo(10,8);
  });
  it('flattens an S bend even when its midpoint lies exactly on the end chord',()=>{
    const s:DxfSpline={degreeOfSplineCurve:3,knotValues:[0,0,0,0,1,1,1,1],controlPoints:[{x:0,y:0},{x:0,y:20},{x:20,y:-20},{x:20,y:0}]};
    const points=flattenDxfSpline(s,1);expect(points.length).toBeGreaterThan(8);
    for(let i=0;i<=1000;i++){const t=i/1000;expect(deviation({x:60*(1-t)*t*t+20*t*t*t,y:60*((1-t)**2*t-(1-t)*t*t)},points)).toBeLessThanOrEqual(.080001);}
  });
  it('handles genuinely periodic, non-clamped knot vectors and closed endpoints',()=>{
    const s:DxfSpline={degreeOfSplineCurve:2,knotValues:[0,1,2,3,4,5,6,7,8],controlPoints:[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1},{x:1,y:0},{x:0,y:1}],closed:true,periodic:true};
    const points=flattenDxfSpline(s,10);expect(distance(points[0],points.at(-1)!)).toBeLessThan(1e-10);
    const part=importDxf(doc(encoded(s)),'periodic');expect(part.contours[0].closed).toBe(true);
  });
  it('rejects broken knot vectors, nonpositive weights, fit-only and tilted splines',()=>{
    for(const s of [{...quarter,weights:[1,-1,1]},{...quarter,knotValues:[0,0,1]},{...quarter,controlPoints:[]},{...quarter,normalVector:{x:1,y:0,z:1}}])expect(()=>flattenDxfSpline(s,1)).toThrow(/SPLINE/);
  });
  it('expands nested blocks, their base points, rotations, scales and array spacing',()=>{
    const child=block('child',rectangle,10,20);
    const parent=block('parent',insert('child','10\n5\n20\n7\n41\n2\n42\n3\n50\n90\n'));
    const part=importDxf(doc(insert('parent','10\n100\n20\n50\n70\n2\n71\n2\n44\n50\n45\n30\n'),child+parent),'nested array');
    expect(part.contours).toHaveLength(4);expect(part.contours.every(c=>c.closed)).toBe(true);
    expect(bounds(part.contours.flatMap(c=>c.points)).width).toBeCloseTo(53,8);
    expect(bounds(part.contours.flatMap(c=>c.points)).height).toBeCloseTo(34,8);
    expect(bounds(part.contours[0].points).width).toBeCloseTo(3,8);
    expect(bounds(part.contours[0].points).height).toBeCloseTo(4,8);
  });
  it('applies nonuniform and reflected scales to rational curves without losing the physical tolerance',()=>{
    const part=importDxf(doc(insert('curve','41\n-10\n42\n20\n'),block('curve',encoded(quarter))),'scaled rational');
    const p=part.contours[0].points;
    expect(bounds(p).width).toBeCloseTo(100,8);expect(bounds(p).height).toBeCloseTo(200,8);
    for(let i=0;i<=1000;i++){const a=i*Math.PI/2000;expect(deviation({x:100*(1-Math.cos(a)),y:200*(1-Math.sin(a))},p)).toBeLessThanOrEqual(.080001);}
  });
  it('rejects missing, circular, tilted and excessive block expansions',()=>{
    expect(()=>importDxf(doc(insert('missing')),'missing')).toThrow(/missing block/);
    expect(()=>importDxf(doc(insert('loop'),block('loop',insert('loop'))),'loop')).toThrow(/circular/);
    expect(()=>importDxf(doc(insert('flat','210\n1\n220\n0\n230\n1\n'),block('flat',rectangle)),'tilted')).toThrow(/Tilted/);
    expect(()=>importDxf(doc(insert('flat','70\n1000\n71\n1000\n'),block('flat',rectangle)),'large')).toThrow(/array dimensions/);
  });
});

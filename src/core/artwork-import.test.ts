import {describe,it,expect} from 'vitest';
import {tracePixels} from './artwork-trace';
import {defaultImportSettings,importSettingsSchema} from './import-settings';
import {flattenDxfSpline,evaluateDxfSpline} from './dxf-spline';
import {bounds,area} from './geometry';
import {importDxf} from './import';
import {decodeDxf} from './dxf-decode';

describe('configurable vector/artwork import',()=>{
  it('defaults to 0.01 mm and validates physical tolerance separately from raster tracing',()=>{
    expect(defaultImportSettings().curveToleranceMm).toBe(.01);
    expect(importSettingsSchema.parse({curveToleranceMm:.025}).curveToleranceMm).toBe(.025);
    for(const n of [0,-1,NaN,Infinity,10])expect(()=>importSettingsSchema.parse({curveToleranceMm:n})).toThrow();
  });
  it('keeps pixel boundaries and holes, and separates diagonally touching pixels',()=>{
    const data=new Uint8ClampedArray(10*10*4);for(let y=1;y<9;y++)for(let x=1;x<9;x++)if(!(x>=3&&x<7&&y>=3&&y<7))data[(y*10+x)*4+3]=255;
    const contours=tracePixels(data,10,10,1,1,defaultImportSettings());expect(contours).toHaveLength(2);
    expect(contours.map(c=>Math.abs(area(c.points))).sort((a,b)=>a-b)).toEqual([16,64]);
    const diagonal=new Uint8ClampedArray(16);diagonal[3]=255;diagonal[15]=255;
    expect(tracePixels(diagonal,2,2,1,1,defaultImportSettings())).toHaveLength(2);
  });
  it('uses composited alpha and the configurable darkness threshold',()=>{
    const rgba=new Uint8ClampedArray([100,100,100,255,200,200,200,255,0,0,0,0]);
    const a=tracePixels(rgba,3,1,1,1,defaultImportSettings());expect(bounds(a[0].points).width).toBe(1);
    const b=tracePixels(rgba,3,1,1,1,{...defaultImportSettings(),traceThreshold:220});expect(bounds(b[0].points).width).toBe(2);
  });
  it('uses tolerance in spline subdivision and reconstructs fit-point curves through their data',()=>{
    const s={degreeOfSplineCurve:3,knotValues:[0,0,0,0,1,1,1,1],controlPoints:[{x:0,y:0},{x:0,y:20},{x:20,y:-20},{x:20,y:0}]};
    expect(flattenDxfSpline(s,1,.01).length).toBeGreaterThan(flattenDxfSpline(s,1,.08).length);
    const fit={degreeOfSplineCurve:3,knotValues:[],controlPoints:[],fitPoints:[{x:0,y:0},{x:10,y:10},{x:20,y:0}]};
    expect(evaluateDxfSpline(fit,1).x).toBeCloseTo(10,8);expect(evaluateDxfSpline(fit,1).y).toBeCloseTo(10,8);
  });
  it('reports unknown DXF entities rather than silently dropping them',()=>{
    const source='0\nSECTION\n2\nENTITIES\n0\nREGION\n1\nopaque ACIS\n0\nENDSEC\n0\nEOF\n';
    expect(()=>importDxf(source,'region')).toThrow(/Unsupported DXF entities: REGION/);
  });
  it('reads hatch polyline boundaries and ignores source/seed metadata',()=>{
    const source='0\nSECTION\n2\nENTITIES\n0\nHATCH\n91\n1\n92\n2\n72\n0\n73\n1\n93\n4\n10\n0\n20\n0\n10\n20\n20\n0\n10\n20\n20\n10\n10\n0\n20\n10\n97\n0\n98\n1\n10\n500\n20\n500\n0\nENDSEC\n0\nEOF\n';
    const p=importDxf(source,'hatch');expect(p.contours).toHaveLength(1);expect(bounds(p.contours[0].points)).toMatchObject({width:20,height:10});
  });
  it('decodes modern binary DXF and rejects truncated binary records',()=>{
    const chunks:number[]=[...new TextEncoder().encode('AutoCAD Binary DXF\r\n'),26,0];
    const group=(code:number,value:string|number,type='string')=>{chunks.push(code&255,code>>8);if(type==='string')chunks.push(...new TextEncoder().encode(String(value)),0);else{const b=new ArrayBuffer(8);new DataView(b).setFloat64(0,Number(value),true);chunks.push(...new Uint8Array(b));}};
    group(0,'SECTION');group(2,'ENTITIES');group(0,'LINE');group(10,0,'double');group(20,0,'double');group(11,20,'double');group(21,10,'double');group(0,'ENDSEC');group(0,'EOF');
    const bytes=new Uint8Array(chunks),p=importDxf(decodeDxf(bytes.buffer),'binary');expect(bounds(p.contours[0].points)).toMatchObject({width:20,height:10});
    expect(()=>decodeDxf(bytes.slice(0,30).buffer)).toThrow(/binary DXF/);
  });
});

import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readJob,viewProject} from '../src/core/job';
import {planForPosting} from '../src/core/postprocessor';
import {inspectReferenceNc} from '../src/core/nc-inspect';
import {bounds,distance} from '../src/core/geometry';
import type {Point} from '../src/core/model';

const root='fixtures/wam-reference/live-2026-11-17/';
const cases=JSON.parse(await readFile(root+'cases.json','utf8'));
const imported=readJob(JSON.parse(await readFile(root+'local-import.wam','utf8')));
if(imported.parts.length!==5)throw Error('Expected five parts imported through the UI');
type Segment={from:Point,to:Point};
function pointDistance(p:Point,m:Segment){const dx=m.to.x-m.from.x,dy=m.to.y-m.from.y,den=dx*dx+dy*dy;const t=den?Math.max(0,Math.min(1,((p.x-m.from.x)*dx+(p.y-m.from.y)*dy)/den)):0;return Math.hypot(p.x-m.from.x-t*dx,p.y-m.from.y-t*dy);}
function directed(a:Segment[],b:Segment[]){let worst=0;for(const m of a){const steps=Math.max(1,Math.ceil(distance(m.from,m.to)/0.2));for(let i=0;i<=steps;i++){const t=i/steps,p={x:m.from.x+(m.to.x-m.from.x)*t,y:m.from.y+(m.to.y-m.from.y)*t};worst=Math.max(worst,Math.min(...b.map(s=>pointDistance(p,s))));}}return worst;}
const results=[];
for(const c of cases){
  const part=imported.parts.find(p=>p.name===c.name+'.svg');if(!part)throw Error('Missing '+c.name);
  const project=viewProject(imported,{kind:'part',id:part.id});project.machine='desktop';
  project.machineSettings={kerf:.9652,abrasive:150,width:460,height:305};
  project.material={...project.material,name:'Aluminum - 6061',thickness:.508,feed:186.59,kerf:.9652,pierce:5,tabWidth:2.54,tabCount:c.tabs,lead:c.lead?.46:0,requiresVerification:true,preset:undefined,source:'Desktop motion comparison only. Pierce time is an unverified placeholder and is excluded from comparison.'};
  project.parts=[{...part,x:12.7,y:12.7,rotation:0,scale:1,cut:c.cut,process:undefined}];
  const raw=await readFile(root+c.name+'.wam-simulation.txt','utf8');
  if(!raw.includes('Machine : Desktop')||!raw.includes('Material thickness : 0.02 in')||!raw.includes('F186.59')||!raw.includes('Cut path  : '+(c.cut==='outside'?'Outside':'Centerline')))throw Error('Mismatched reference '+c.name);
  // WAM's demo omits G90/G21 and valve/dwell commands. Interpret its motion
  // coordinates in the absolute-mm convention established by full captures.
  const wam=inspectReferenceNc('G90\nG21\n'+raw), local=planForPosting(project);
  const a=wam.moves.filter(m=>!m.rapid&&distance(m.from,m.to)>1e-8), b=local.moves.filter(m=>m.kind==='cut'&&distance(m.from,m.to)>1e-8);
  const referenceBounds=bounds(a.flatMap(m=>[m.from,m.to])),localBounds=bounds(b.flatMap(m=>[m.from,m.to]));
  const maxDeviation=Math.max(directed(a,b),directed(b,a));
  const localLength=b.reduce((n,m)=>n+distance(m.from,m.to),0), localCutSeconds=b.reduce((n,m)=>n+60*distance(m.from,m.to)/(m.feed??project.material.feed),0);
  const result={name:c.name,machine:'desktop',contours:part.contours.length,holes:part.contours.filter(c=>c.hole).length,cut:c.cut,tabsPerContour:c.tabs,leadMm:project.material.lead,tabWidthMm:project.material.tabWidth,nominalFeed:186.59,referenceOperations:wam.segments,localOperations:local.operations.length,referenceCutLengthMm:wam.cutLength,localCutLengthMm:localLength,cutLengthDeltaMm:localLength-wam.cutLength,referenceLinearSeconds:wam.linearSeconds,localLinearSeconds:localCutSeconds,maxSampledCutDeviationMm:maxDeviation,referenceBounds,localBounds,localIssues:local.issues,geometryMatchesWithinPointOneMm:maxDeviation<.1,referenceSha256:createHash('sha256').update(raw).digest('hex')};
  results.push(result);
  await writeFile(root+c.name+'.local-preview.json',JSON.stringify({project,operations:local.operations,moves:local.moves},null,2)+'\n');
  await writeFile(root+c.name+'.comparison-paths.json',JSON.stringify({reference:wam.moves,local:local.moves},null,2)+'\n');
}
await writeFile(root+'comparison.json',JSON.stringify({version:'0.8.1',date:'2026-11-17',physicalCutTested:false,scope:'Five fresh Desktop simulation motion captures versus local planned motion, plus separate 11 full Pro posting comparisons in ../posting-0.8.1/comparison.json.',limitations:['Desktop demo omits initialization/valve commands and pierce dwells; full Desktop executable output and total time are not validated.','The tabbed case uses an approximate 0.46 mm lead radius read from rounded simulation coordinates; other cases disable leads.','Different entry and tab locations can produce local geometric differences without changing the finished profile.','Hausdorff-style distance samples cut moves every 0.2 mm; it is not a proof of physical cut quality.'],results},null,2)+'\n');
console.table(results.map(r=>({name:r.name,wamMm:r.referenceCutLengthMm.toFixed(3),localMm:r.localCutLengthMm.toFixed(3),maxDeviationMm:r.maxSampledCutDeviationMm.toFixed(3),wamOps:r.referenceOperations,localOps:r.localOperations,wamCutSec:r.referenceLinearSeconds.toFixed(2),localCutSec:r.localLinearSeconds.toFixed(2)})));

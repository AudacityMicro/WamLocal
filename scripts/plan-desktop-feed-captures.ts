import {readFile,writeFile} from 'node:fs/promises';
import {gaugesFor} from '../src/core/material-gauges';
import {COMMON_METRIC_THICKNESSES_MM,COMMON_FRACTIONAL_THICKNESSES_IN} from '../src/core/common-thicknesses';
const folder='fixtures/wam-reference/desktop-demo/';
const existing=JSON.parse(await readFile(folder+'all-material-feeds.json','utf8'));
const tasks=[];
for(const row of existing) {
  if(row.thicknessIn!==0.02 && Math.abs(row.thicknessMm-0.508)>1e-7)continue;
  const max=existing.find((r:any)=>r.name===row.name&&r.maximumThicknessIn!==undefined)?.maximumThicknessIn??row.maximumThicknessMm/25.4;
  const target=[0.001,0.01,0.04,...COMMON_FRACTIONAL_THICKNESSES_IN,max,Math.floor((max-0.002)*1000)/1000,...COMMON_METRIC_THICKNESSES_MM.map(mm=>mm/25.4),...gaugesFor(row.name).map(g=>Number((g.mm/25.4).toFixed(5)))];
  for(const thicknessIn of [...new Set(target)].sort((a,b)=>a-b))
    if(thicknessIn>0 && thicknessIn<=max+1e-9 && !existing.some((r:any)=>r.name===row.name&&Math.abs(r.thicknessMm-thicknessIn*25.4)<1e-7))tasks.push({category:row.category,name:row.name,thicknessIn});
}
await writeFile(folder+'capture-plan.json',JSON.stringify(tasks,null,2));
console.log(tasks.length+' captures planned');

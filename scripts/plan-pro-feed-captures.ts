import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gaugesFor} from '../src/core/material-gauges';
import {materialPresets} from '../src/core/material-presets';
import {thicknessKey} from '../src/core/material-selection';
import {COMMON_METRIC_THICKNESSES_MM,COMMON_FRACTIONAL_THICKNESSES_IN} from '../src/core/common-thicknesses';
const folder='fixtures/wam-reference/pro-demo/';await mkdir(folder,{recursive:true});
const catalog=JSON.parse(await readFile(folder+'catalog.json','utf8'));
const limits=JSON.parse(await readFile('fixtures/wam-reference/material-limits.json','utf8')).materials;
const existing=JSON.parse(await readFile(folder+'all-material-feeds.json','utf8').catch(()=>"[]"));
const tasks=[];
for(const category of catalog)for(const name of category.names){
  const limit=limits.find((p:any)=>p.name===name);if(!limit)throw Error('New Pro material: '+name);
  const sizes=[0.01,0.02,0.04,...COMMON_FRACTIONAL_THICKNESSES_IN,...COMMON_METRIC_THICKNESSES_MM.map(mm=>mm/25.4),...gaugesFor(name).map(g=>Number((g.mm/25.4).toFixed(5)))];
  for(const thicknessIn of [...new Set(sizes)].sort((a,b)=>a-b))if(thicknessIn<=limit.max && !materialPresets.some(p=>p.name===name&&thicknessKey(p.thicknessMm)===thicknessKey(thicknessIn*25.4)) && !existing.some((r:any)=>r.name===name&&thicknessKey(r.thicknessMm)===thicknessKey(thicknessIn*25.4)))tasks.push({category:category.category,name,thicknessIn});
}
await writeFile(folder+'capture-plan.json',JSON.stringify(tasks,null,2));console.log(tasks.length+' additional common-size Pro feed captures');

import {writeFile} from 'node:fs/promises';
import {initialMaterialLibrary} from '../src/core/material-library';
import captures from '../src/core/material-feed-captures.json';
import {materialPresets,presetIssue} from '../src/core/material-presets';
import {interpolateMaterialCurve} from '../src/core/material-estimate';

const library=initialMaterialLibrary();
const holdouts=[];
for(const c of captures.filter(c=>c.machine==='pro')){
  const rows=materialPresets.filter(p=>p.name===c.name).sort((a,b)=>a.thicknessMm-b.thicknessMm);
  const i=rows.findIndex(r=>r.thicknessMm>c.thicknessMm);
  if(i<=0||rows[i].thicknessMm/rows[i-1].thicknessMm>2.01)continue;
  const estimated=interpolateMaterialCurve(rows,c.thicknessMm);
  for(const q of ['coarse','medium','fine'] as const)holdouts.push({name:c.name,thicknessMm:c.thicknessMm,quality:q,recorded:c.feeds[q],estimated:estimated.feeds[q],errorPercent:100*Math.abs(estimated.feeds[q]/c.feeds[q]-1)});
}
holdouts.sort((a,b)=>b.errorPercent-a.errorPercent);
await writeFile('fixtures/wam-reference/materials/common-size-feed-holdouts.json',JSON.stringify({date:'2026-11-17',description:'Independent demo feed measurements compared against interpolation of the earlier full Pro references. Feed only; not physical cut validation.',count:holdouts.length,worst:holdouts[0],rows:holdouts},null,2)+'\n');
const rows=['# Both-machine material coverage','', 'Captured from WAM 2.5.0 on 2026-11-17. Common-size coverage is enforced by `src/core/material-coverage.test.ts`. Both capture planners finish with zero pending points.','', '| Machine | Materials | New feed-only thickness captures | Quality feeds | Full process reference thicknesses |','|---|---:|---:|---:|---:|'];
for(const machine of ['desktop','pro']){
 const points=captures.filter(c=>c.machine===machine);
 rows.push(`| ${machine==='desktop'?'WAZER Desktop':'WAZER Pro'} | ${new Set(points.map(p=>p.name)).size} | ${points.length} | ${points.length*3} | ${materialPresets.filter(p=>p.machine===machine).length} |`);
}
rows.push('',`The shared library contains ${library.materials.length} records, including user-editable defaults, gauge aliases and all three qualities. Full Pro references include ${materialPresets.filter(p=>!presetIssue(p)).length} usable process records and ${materialPresets.filter(p=>presetIssue(p)).length} with invalid tab/lead defaults that still require review.`, '',
'Common stock: 0.5, 0.8, 1, 1.2, 1.5, 1.6, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 16, 18, 20, 22, 24 and 25 mm; 1/64, 1/32, 1/16, 3/32, 1/8, 5/32, 3/16, 1/4, 5/16, 3/8, 7/16, 1/2, 5/8, 3/4, 7/8 and 1 inch; material-specific 7–26 gauge steel, stainless and aluminum. Sizes are included only within the WAM limit for that machine/material. Additional thin probes and endpoints are captured.', '',
'## Scope and remaining limits','',
'Demo captures contain exact nominal coarse/medium/fine feeds from the visible simulation NC editor. Demo mode disables job/workspace exports and omits M-codes and pierce dwell. These records do not establish Desktop pierce/lead parameters. Unknown values remain null in the evidence and flagged for review in presets; Pro values are never reused as Desktop values. Existing full Pro workspace captures retain their complete process values.', '',
'Custom thicknesses use bounded, shape-preserving interpolation between same-machine/material measurements, with a maximum 2.01:1 bracket ratio and no extrapolation. Full-process parameters use full references; Desktop can estimate feeds only and leaves other settings unchanged. Estimates remain flagged until explicitly reviewed. Pierce transitions are not reliably predicted by the model.', '',
`Independent common-size Pro feed holdouts: ${holdouts.length} quality comparisons; worst relative error ${holdouts[0]?.errorPercent.toFixed(2)}% (${holdouts[0]?.name}). The library uses the exact recorded feed at these points. See common-size-feed-holdouts.json. This does not validate pierce settings or physical cut quality.`, '',
'## Material limits','', '| Machine | Material | Maximum thickness (in) |','|---|---|---:|');
for(const machine of ['desktop','pro'])for(const name of [...new Set(captures.filter(c=>c.machine===machine).map(c=>c.name))].sort()){
 const max=captures.find(c=>c.machine===machine&&c.name===name)?.maximumThicknessIn;
 rows.push(`| ${machine} | ${name} | ${max} |`);
}
rows.push('', 'Raw evidence: `../desktop-demo/all-material-feeds.json`, `../pro-demo/all-material-feeds.json`, their SHA-256 capture-hash.json files, and the existing full Pro workspace exports. Regenerate shipping data with `node scripts/build-material-feed-captures.mjs`; regenerate this report with `npx tsx scripts/report-material-coverage.ts`.','');
await writeFile('fixtures/wam-reference/materials/BOTH-MACHINES.md',rows.join('\n'));
console.log({libraryRecords:library.materials.length,feedCaptures:captures.length,holdouts:holdouts.length,worstFeedError:holdouts[0]});

import {readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {initialMaterialLibrary,extendMaterialLibrary} from '../src/core/material-library';
import {materialLibrarySchema,type MaterialLibrary,type JobMaterial} from '../src/core/job';
import {materialName,materialQuality,thicknessKey} from '../src/core/material-selection';
import {materialHierarchy} from '../src/core/material-hierarchy';
import {feedCaptures as captures} from '../src/core/material-feed-corrections';
import {materialPresets} from '../src/core/material-presets';
import {estimateMaterialSettings} from '../src/core/material-estimate';

const qualities=['coarse','medium','fine'] as const;
const profileKey=(m:JobMaterial)=>`${m.machine}|${materialName(m)}|${thicknessKey(m.thickness)}|${materialQuality(m)}`;
const feedCaptures=new Map(captures.flatMap(c=>qualities.map(q=>[`${c.machine}|${c.name}|${thicknessKey(c.thicknessMm)}|${q}`,c.feeds[q]] as const)));
const fullCaptures=new Map(materialPresets.flatMap(c=>qualities.map(q=>[`${c.machine}|${c.name}|${thicknessKey(c.thicknessMm)}|${q}`,c.feeds[q]] as const)));
const sourceFeed=(m:JobMaterial)=>{
  const a=feedCaptures.get(profileKey(m)),b=fullCaptures.get(profileKey(m));
  const close=(v:number)=>Math.abs(v-m.feed)<=Math.max(.021,Math.abs(v)*.0001);
  const matched=[a,b].some(v=>v!==undefined&&close(v));
  return {demo:a,full:b,matched,available:a!==undefined||b!==undefined};
};
const row=(m:JobMaterial)=>({id:m.id,machine:m.machine,material:materialName(m),family:materialHierarchy(m).family,thicknessMm:m.thickness,quality:materialQuality(m),feedMmMin:m.feed,pierceSeconds:m.pierce,requiresVerification:!!m.requiresVerification,source:m.source??'',evidence:sourceFeed(m)});
function audit(db:MaterialLibrary){
  const evidenceMismatch=db.materials.filter(m=>sourceFeed(m).available&&!sourceFeed(m).matched).map(row);
  const generic=db.materials.filter(m=>m.requiresVerification&&m.feed===100&&!sourceFeed(m).matched);
  const groups=new Map<string,JobMaterial[]>();
  for(const m of db.materials){if(materialQuality(m)==='custom')continue;const k=`${m.machine}|${materialName(m)}|${materialQuality(m)}`;groups.set(k,[...(groups.get(k)??[]),m]);}
  const increases:any[]=[],flatRuns:any[]=[],duplicateConflicts:any[]=[];
  for(const [key,records] of groups){
    const byThickness=new Map<string,JobMaterial[]>();for(const m of records){const k=thicknessKey(m.thickness);byThickness.set(k,[...(byThickness.get(k)??[]),m]);}
    const sorted=[...byThickness.values()].map(list=>{
      const rates=[...new Set(list.map(m=>m.feed))];
      if(rates.length>1&&Math.max(...rates)/Math.min(...rates)>1.01)duplicateConflicts.push({key,thicknessMm:list[0].thickness,records:list.map(row)});
      return [...list].sort((a,b)=>Number(sourceFeed(b).matched)-Number(sourceFeed(a).matched)||Number(!!a.requiresVerification)-Number(!!b.requiresVerification))[0];
    }).sort((a,b)=>a.thickness-b.thickness);
    let run:JobMaterial[]=[];
    const flush=()=>{if(run.length>=3&&run.at(-1)!.thickness/run[0].thickness>=1.5)flatRuns.push({key,count:run.length,from:row(run[0]),to:row(run.at(-1)!),feedMmMin:run[0].feed,allSourceMatched:run.every(m=>sourceFeed(m).matched),allFlagged:run.every(m=>m.requiresVerification)});};
    for(let i=0;i<sorted.length;i++){
      const m=sorted[i],previous=sorted[i-1];
      if(previous&&m.feed>previous.feed*1.03)increases.push({key,from:row(previous),to:row(m),increasePercent:100*(m.feed/previous.feed-1),bothSourceMatched:sourceFeed(previous).matched&&sourceFeed(m).matched});
      if(run.length&&Math.abs(m.feed/run[0].feed-1)>.001){flush();run=[];}run.push(m);
    }flush();
  }
  const qualityGroups=new Map<string,Map<string,JobMaterial>>();
  for(const m of db.materials){const key=`${m.machine}|${materialName(m)}|${thicknessKey(m.thickness)}`;if(!qualityGroups.has(key))qualityGroups.set(key,new Map());const q=materialQuality(m);const old=qualityGroups.get(key)!.get(q);if(!old||(!sourceFeed(old).matched&&sourceFeed(m).matched))qualityGroups.get(key)!.set(q,m);}
  const reversedQualities:any[]=[],flatQualities:any[]=[];
  for(const [key,group] of qualityGroups){const c=group.get('coarse'),m=group.get('medium'),f=group.get('fine');if(!c||!m||!f)continue;
    if(c.feed+.02<m.feed||m.feed+.02<f.feed)reversedQualities.push({key,records:[c,m,f].map(row)});
    if(Math.max(c.feed,m.feed,f.feed)/Math.min(c.feed,m.feed,f.feed)<1.001)flatQualities.push({key,records:[c,m,f].map(row),allSourceMatched:[c,m,f].every(m=>sourceFeed(m).matched)});
  }
  const plasticVsSteel:any[]=[];
  for(const p of db.materials.filter(m=>materialHierarchy(m).family==='Plastic'&&materialQuality(m)!=='custom')){
    const steel=qualityGroups.get(`${p.machine}|Steel - 1018|${thicknessKey(p.thickness)}`)?.get(materialQuality(p));
    if(!steel||p.feed>=steel.feed*.99)continue;
    plasticVsSteel.push({plastic:row(p),steel:row(steel),timeRatio:steel.feed/p.feed,secondsPerMeterPlastic:60000/p.feed,secondsPerMeterSteel:60000/steel.feed,bothSourceMatched:sourceFeed(p).matched&&sourceFeed(steel).matched});
  }
  const processPlaceholders=db.materials.filter(m=>m.source?.includes('Pierce/lead values are application defaults pending review'));
  const tallies=(rows:JobMaterial[])=>[...new Set(rows.map(m=>`${m.machine}|${materialName(m)}`))].map(key=>({key,count:rows.filter(m=>`${m.machine}|${materialName(m)}`===key).length})).sort((a,b)=>b.count-a.count);
  return {records:db.materials.length,materialsByMachine:[...new Set(db.materials.map(m=>`${m.machine}|${materialName(m)}`))].length,counts:{evidenceMismatch:evidenceMismatch.length,genericFeeds:generic.length,duplicateConflicts:duplicateConflicts.length,feedIncreases:increases.length,sourceMatchedIncreases:increases.filter(x=>x.bothSourceMatched).length,flatRuns:flatRuns.length,sourceMatchedFlatRuns:flatRuns.filter(x=>x.allSourceMatched).length,reversedQualities:reversedQualities.length,flatQualities:flatQualities.length,plasticSlowerThanSteel:plasticVsSteel.length,sourceMatchedPlasticSlowerThanSteel:plasticVsSteel.filter(x=>x.bothSourceMatched).length,feedOnlyWithGenericProcess:processPlaceholders.length},genericFeedsByMaterial:tallies(generic),processPlaceholdersByMaterial:tallies(processPlaceholders),evidenceMismatch,duplicateConflicts,feedIncreases:increases.sort((a,b)=>b.increasePercent-a.increasePercent),flatRuns:flatRuns.sort((a,b)=>b.count-a.count),reversedQualities,flatQualities,plasticVsSteel:plasticVsSteel.sort((a,b)=>b.timeRatio-a.timeRatio)};
}
const shipping=initialMaterialLibrary();
const savedPath=process.argv[2]??path.join(process.env.APPDATA??'.','wam-local','material-library.json');
let savedInfo:any=null,saved:MaterialLibrary|undefined;
try{const raw=await readFile(savedPath,'utf8');saved=materialLibrarySchema.parse(JSON.parse(raw));savedInfo={path:savedPath,modified:(await stat(savedPath)).mtime.toISOString(),sha256:createHash('sha256').update(raw).digest('hex')};}catch(e:any){if(e.code!=='ENOENT')throw e;}
const sourceConflicts:any[]=[];
for(const c of captures)for(const q of qualities){const full=fullCaptures.get(`${c.machine}|${c.name}|${thicknessKey(c.thicknessMm)}|${q}`);if(full!==undefined&&Math.abs(full/c.feeds[q]-1)>.01)sourceConflicts.push({machine:c.machine,material:c.name,thicknessMm:c.thicknessMm,quality:q,fullFeed:full,demoFeed:c.feeds[q],differencePercent:100*(full/c.feeds[q]-1)});}
const report={date:'2026-11-19',version:'0.12.0',scope:'Read-only audit of every shipping preset and the saved user library. Feed comparisons use identical machine, stock thickness and quality. Cut-time comparison is per metre with no pierce overhead. Flags are diagnostic, not automatic process corrections.',savedLibrary:savedInfo,shipping:audit(shipping),saved:saved?audit(saved):null,upgradedSaved:saved?audit(extendMaterialLibrary(saved)):null,sourceConflicts};
const interpolationCandidates=shipping.materials.filter(m=>m.requiresVerification&&m.feed===100&&!sourceFeed(m).matched).map(m=>{
  try{const estimated=estimateMaterialSettings(m,m.thickness,materialQuality(m) as typeof qualities[number]);return {record:row(m),candidateFeedMmMin:estimated.feed,requiresVerification:estimated.requiresVerification,source:estimated.source};}
  catch(error){return {record:row(m),unavailableReason:(error as Error).message};}
});
const qualityRatioExceptions=captures.filter(c=>Math.abs(c.feeds.coarse/c.feeds.medium-1.125)>.015||Math.abs(c.feeds.fine/c.feeds.medium-.875)>.015).map(c=>({machine:c.machine,material:c.name,thicknessMm:c.thicknessMm,feeds:c.feeds,coarseToMedium:c.feeds.coarse/c.feeds.medium,fineToMedium:c.feeds.fine/c.feeds.medium,note:'Deviation from the dominant empirical quality ratios, not a proof of an invalid preset.'}));
let liveChecks:unknown[]=[];
try{liveChecks=JSON.parse(await readFile('artifacts/wam-live-material-audit-2026-11-18.json','utf8'));}catch{}
let confirmedLiveMismatch:unknown=null;
try{
  const code=await readFile('artifacts/wam-steel1095-coarse-visible-code.txt','utf8');
  const live=Number(code.match(/G1[^\r\n]*\sF(\d+(?:\.\d+)?)/)?.[1]);
  const stored=shipping.materials.find(m=>m.machine==='desktop'&&materialName(m)==='Steel - 1095'&&Math.abs(m.thickness-.8)<1e-7&&materialQuality(m)==='coarse');
  if(stored&&live>0)confirmedLiveMismatch={machine:'desktop',material:'Steel - 1095',thicknessMm:.8,quality:'coarse',storedFeedMmMin:stored.feed,liveFeedMmMin:live,storedHigherPercent:100*(stored.feed/live-1),evidence:'artifacts/wam-steel1095-coarse-visible-code.txt',note:'Read from visible WAM simulation G-code captured on 2026-11-18. Saved presets remain unchanged.'};
}catch{}
const result={...report,interpretation:{archiveAgreementIsNotProcessValidation:true,lowConstantRateMaterials:['pro|EPDM - EPDM','pro|Polyethylene Foam - 4lb'],lowConstantRateRuns:report.shipping.flatRuns.filter(r=>r.feedMmMin<100).length,highConstantRateRuns:report.shipping.flatRuns.filter(r=>r.feedMmMin>=100).length,highRatePlateauExplanation:'Consistent with the common observed 1500.3/1333.6/1166.9 mm/min quality-dependent ceiling; this is an inference, not physical validation.',interpolationEligible:interpolationCandidates.filter(r=>'candidateFeedMmMin'in r).length,interpolationUnavailable:interpolationCandidates.filter(r=>'unavailableReason'in r).length},confirmedLiveMismatch,qualityRatioExceptions,liveChecks,interpolationCandidates};
await writeFile('artifacts/material-preset-audit-2026-11-19.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({shipping:report.shipping.counts,saved:report.saved?.counts,interpretation:result.interpretation,confirmedLiveMismatch,qualityRatioExceptions:qualityRatioExceptions.length,interpolationFailures:interpolationCandidates.filter(r=>'unavailableReason'in r).map(r=>({record:r.record,reason:r.unavailableReason}))},null,2));

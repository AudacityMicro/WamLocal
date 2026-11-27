import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const rows=[];
for(const machine of ['desktop','pro']) {
  const folder=`fixtures/wam-reference/${machine}-demo/`;
  const raw=await readFile(folder+'all-material-feeds.json','utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(!raw)continue;
  const captures=JSON.parse(raw);rows.push(...captures);
  await writeFile(folder+'capture-hash.json',JSON.stringify({date:'2026-11-17',sha256:createHash('sha256').update(raw).digest('hex'),records:captures.length,qualities:captures.length*3,materialCount:new Set(captures.map(r=>r.name)).size,completeProcessProfiles:0},null,2)+'\n');
}
const keys=new Set();
for(const r of rows){
  const key=r.machine+'|'+r.name+'|'+r.thicknessMm.toFixed(7);
  if(keys.has(key))throw Error('Duplicate '+key); keys.add(key);
  if(!(r.feeds.coarse>=r.feeds.medium&&r.feeds.medium>=r.feeds.fine&&r.feeds.fine>0))throw Error('Invalid feeds '+key);
  if(r.snippets)for(const q of ['coarse','medium','fine']) {
    const feed=Number(r.snippets[q].match(/G1 [^\n]* F([\d.]+)/)?.[1]);
    if(feed!==r.feeds[q])throw Error('Evidence mismatch '+key+' '+q);
  }
}
const compact=rows.map(({snippets,...r})=>r).sort((a,b)=>a.machine.localeCompare(b.machine)||a.name.localeCompare(b.name)||a.thicknessMm-b.thicknessMm);
await writeFile('src/core/material-feed-captures.json',JSON.stringify(compact,null,2)+'\n');
console.log(compact.length+' feed records built; no pierce/lead/abrasive values fabricated.');

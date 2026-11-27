import fs from 'node:fs';
const root='fixtures/wam-reference/live-2026-11-17/';
const report=JSON.parse(fs.readFileSync(root+'comparison.json','utf8'));
const pieces=[];
report.results.forEach((r,i)=>{
 const paths=JSON.parse(fs.readFileSync(root+r.name+'.comparison-paths.json','utf8'));
 const x=24+(i%3)*330,y=100+Math.floor(i/3)*290;
 const b=r.referenceBounds,scale=Math.min(270/Math.max(b.width,1),170/Math.max(b.height,1));
 const moves=(items,kind)=>items.filter(m=>kind==='reference'?!m.rapid:m.kind==='cut').map(m=>`M${((m.from.x-b.x)*scale).toFixed(3)} ${((m.from.y-b.y)*scale).toFixed(3)}L${((m.to.x-b.x)*scale).toFixed(3)} ${((m.to.y-b.y)*scale).toFixed(3)}`).join('');
 pieces.push(`<g transform="translate(${x} ${y})"><rect width="310" height="270" rx="8" fill="#19262d"/><text x="16" y="26" font-size="17" fill="#ecf4f6">${r.name}</text><g transform="translate(20 45)" fill="none" stroke-linecap="round"><path d="${moves(paths.reference,'reference')}" stroke="#efaa6e" stroke-width="2.8"/><path d="${moves(paths.local,'local')}" stroke="#7be2e8" stroke-width="1.4" stroke-dasharray="4 2"/></g><text x="16" y="233" fill="#b6cbd3" font-size="12">Max sampled difference: ${r.maxSampledCutDeviationMm.toFixed(3)} mm</text><text x="16" y="253" fill="#b6cbd3" font-size="12">Cut motion: WAM ${r.referenceLinearSeconds.toFixed(1)}s / Local ${r.localLinearSeconds.toFixed(1)}s</text></g>`);
});
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1038" height="744" viewBox="0 0 1038 744"><rect width="1038" height="744" fill="#101b21"/><g font-family="Segoe UI,Arial,sans-serif"><text x="24" y="36" font-size="24" fill="#ecf4f6">WAM vs Wam Local 0.8.1 · five fresh parts</text><text x="24" y="62" font-size="14" fill="#b6cbd3">Desktop · Aluminum 6061 · 0.020 in · Medium · same imported SVG paths</text><path d="M24 82h35" stroke="#efaa6e" stroke-width="3"/><text x="67" y="87" fill="#efaa6e" font-size="13">WAM simulation</text><path d="M230 82h35" stroke="#7be2e8" stroke-width="2" stroke-dasharray="4 2"/><text x="277" y="87" fill="#7be2e8" font-size="13">Local planned motion</text>${pieces.join('')}<text x="24" y="704" font-size="13" fill="#b6cbd3">Tabbed part: entry and tab positions differ. Cutting-time estimates differ because feed schedules differ.</text><text x="24" y="725" font-size="13" fill="#b6cbd3">Motion comparison only. Demo omits pierce/valve commands; no physical cuts were tested.</text></g></svg>`;
fs.writeFileSync('artifacts/wam-comparison-0.8.1.svg',svg);

import { materialPresets } from "./material-presets";
import feedCaptures from "./material-feed-captures.json";

const limits = new Map<string, number>();
const names = new Set<string>();
for (const p of materialPresets) {
  names.add(p.name);
  const key=`${p.machine}|${p.name}`;
  limits.set(key,Math.max(limits.get(key)??0,p.thicknessMm));
}
for(const p of feedCaptures) {
  names.add(p.name);
  if(p.maximumThicknessIn!==undefined) limits.set(`${p.machine}|${p.name}`,p.maximumThicknessIn*25.4);
}
export function referenceThicknessLimit(machine:"pro"|"desktop",name:string){return limits.get(`${machine}|${name}`);}
export function outsideReferenceCatalog(machine:"pro"|"desktop",name:string,thickness:number) {
  if(!names.has(name))return false; // User-defined stock has its own process.
  const limit=referenceThicknessLimit(machine,name);
  return limit===undefined || thickness>limit+0.00001;
}

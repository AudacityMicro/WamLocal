import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {initialMaterialLibrary,extendMaterialLibrary} from "../src/core/material-library";
import {materialLibrarySchema,type MaterialLibrary} from "../src/core/job";
import {defaultMachineSettings} from "../src/core/machine-settings";

// Numeric completeness and measurement provenance are separate: a valid number
// can be an application default or an estimate, not a measured process value.
function audit(library:MaterialLibrary){
  const issues:{id:string;field:string;value:unknown}[]=[];
  let inheritedAbrasive=0,inheritedPierceDiameter=0;
  for(const m of library.materials){
    const machine=library.machines?.[m.machine]??defaultMachineSettings(m.machine);
    if(m.abrasive===undefined)inheritedAbrasive++;
    if(!m.pierceDiameter)inheritedPierceDiameter++;
    const values={thickness:m.thickness,feed:m.feed,pierce:m.pierce,lead:m.lead,
      kerf:m.kerf,tabWidth:m.tabWidth,tabCount:m.tabCount,
      abrasive:m.abrasive??machine.abrasive,pierceDiameter:m.pierceDiameter||machine.kerf};
    for(const [field,value] of Object.entries(values)){
      if(!Number.isFinite(value)||value<0||(["thickness","feed"].includes(field)&&value===0)||field==="tabCount"&&!Number.isInteger(value))issues.push({id:m.id,field,value});
    }
  }
  return {records:library.materials.length,numericFieldsPerRecord:9,issues,
    inheritedAbrasive,inheritedPierceDiameter,
    recordsRequiringVerification:library.materials.filter(m=>m.requiresVerification).length,
    feedOnlyWithDefaultProcess:library.materials.filter(m=>m.requiresVerification&&m.pierce===5&&m.lead===2&&m.source?.includes("demo feed capture")).length};
}
const shipping=audit(initialMaterialLibrary());
const file=path.join(process.env.APPDATA??".","wam-local","material-library.json");
let saved:ReturnType<typeof audit>|null=null;
try{saved=audit(extendMaterialLibrary(materialLibrarySchema.parse(JSON.parse(await readFile(file,"utf8")))));}catch(error:any){if(error.code!=="ENOENT")throw error;}
assert.deepEqual(shipping.issues,[]);if(saved)assert.deepEqual(saved.issues,[]);
const report={version:"0.12.1",date:"2026-11-19",shipping,saved,
  note:"Numeric completeness does not certify measurements. Existing verification flags, user values and saved job snapshots are preserved. Zero pierce diameter inherits machine kerf; absent abrasive inherits the machine rate."};
await writeFile("artifacts/preset-numbers-0.12.1.json",JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));

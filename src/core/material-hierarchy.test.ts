import {describe,it,expect} from "vitest";
import {materialHierarchy,MATERIAL_FAMILIES} from "./material-hierarchy";
import {defaultMaterial,jobMaterialSchema} from "./job";
import {materialName} from "./material-selection";
import captures from "./material-feed-captures.json";
describe("material organization",()=>{
  it.each([
    ["Aluminum - 6061","Metal","Aluminum","6061"],
    ["Steel - 1095","Metal","Steel","1095"],
    ["Stainless Steel - 304","Metal","Stainless Steel","304"],
    ["Silicone - 50A","Rubbers","Silicone","50A"],
    ["Neoprene - 50A","Rubbers","Neoprene","50A"],
    ["EPDM Foam","Rubbers","EPDM","Foam"],
    ["Polyethylene Foam - 4lb","Plastic","Polyethylene","4lb Foam"],
    ["Glass - Borosilicate","Ceramics","Glass","Borosilicate"],
    ["Graphite - Graphite","Other","","Graphite"],
  ])("organizes %s without replacing the stock identity",(name,family,materialClass,grade)=>{
    expect(materialHierarchy({name})).toEqual({family,materialClass,grade});
  });
  it("classifies every existing catalog material and respects edited organization across serialization",()=>{
    for(const name of new Set(captures.map(m=>m.name))){const h=materialHierarchy({name});expect(MATERIAL_FAMILIES).toContain(h.family);expect(h.grade.length).toBeGreaterThan(0);}
    const material={...defaultMaterial("desktop"),name:"Aluminum - 6061",stockKey:"Aluminum - 6061",family:"Other" as const,materialClass:"Shop stock",grade:"6061-T6",organizationRevision:123};
    const saved=jobMaterialSchema.parse(JSON.parse(JSON.stringify(material)));
    expect(materialHierarchy(saved)).toEqual({family:"Other",materialClass:"Shop stock",grade:"6061-T6"});
    expect(materialName(saved)).toBe("Aluminum - 6061");expect(saved.feed).toBe(material.feed);
  });
});

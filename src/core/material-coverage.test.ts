import {describe,it,expect} from 'vitest';
import {initialMaterialLibrary} from './material-library';
import {materialName,materialQuality,thicknessKey} from './material-selection';
import {COMMON_METRIC_THICKNESSES_MM,COMMON_FRACTIONAL_THICKNESSES_IN} from './common-thicknesses';
import {gaugesFor} from './material-gauges';
import {referenceThicknessLimit} from './material-coverage';
import {feedCaptures as captures} from './material-feed-corrections';
import {estimateMaterialSettings} from './material-estimate';
import {materialPresets} from './material-presets';
import desktop from '../../fixtures/wam-reference/desktop-demo/catalog.json';
import pro from '../../fixtures/wam-reference/pro-demo/catalog.json';

describe('both machine material coverage',()=>{
  it('has measured feeds at every supported common metric, fractional and gauge size, for all qualities',()=>{
    const library=initialMaterialLibrary();
    const profiles=new Map(library.materials.map(m=>[`${m.machine}|${materialName(m)}|${thicknessKey(m.thickness)}|${materialQuality(m)}`,m]));
    const measured=new Set([
      ...captures.map(c=>`${c.machine}|${c.name}|${thicknessKey(c.thicknessMm)}`),
      ...materialPresets.map(p=>`${p.machine}|${p.name}|${thicknessKey(p.thicknessMm)}`),
    ]);
    for(const [machine,catalog,count] of [['desktop',desktop,28],['pro',pro,24]] as const){
      const names=catalog.flatMap(c=>c.names);expect(new Set(names).size).toBe(count);
      for(const name of names){
        const limit=referenceThicknessLimit(machine,name);expect(limit,name).toBeGreaterThan(0);
        const sizes=[...COMMON_METRIC_THICKNESSES_MM,...COMMON_FRACTIONAL_THICKNESSES_IN.map(n=>n*25.4),...gaugesFor(name).map(g=>g.mm),0.508];
        for(const size of sizes.filter(n=>n<=limit!+1e-7)){
          const key=`${machine}|${name}|${thicknessKey(size)}`;
          expect(measured.has(key),`Missing measured feed: ${key}`).toBe(true);
          for(const quality of ['coarse','medium','fine']){
            const profile=profiles.get(`${key}|${quality}`);
            expect(profile,`Missing profile: ${key}|${quality}`).toBeDefined();
            expect(profile!.feed).toBeGreaterThan(0);
            const reference=materialPresets.find(p=>p.machine===machine&&p.name===name&&thicknessKey(p.thicknessMm)===thicknessKey(size))??captures.find(p=>p.machine===machine&&p.name===name&&thicknessKey(p.thicknessMm)===thicknessKey(size));
            const expected=machine==='pro'&&name==='EPDM - EPDM'?estimateMaterialSettings(profile!,size,quality as 'coarse'|'medium'|'fine').feed:reference!.feeds[quality as 'coarse'|'medium'|'fine'];
            expect(Math.abs(profile!.feed-expected),`${key}|${quality} must use the measured feed`).toBeLessThan(0.02);
            if(machine==='desktop')expect(profile!.requiresVerification).toBe(true);
          }
        }
      }
    }
  });
  it('keeps every captured feed positive and ordered without manufacturing missing process values',()=>{
    for(const row of captures){
      expect(row.feeds.coarse).toBeGreaterThanOrEqual(row.feeds.medium);
      expect(row.feeds.medium).toBeGreaterThanOrEqual(row.feeds.fine);
      expect(row.feeds.fine).toBeGreaterThan(0);
      expect(row.pierce).toBeNull();expect(row.lead).toBeNull();expect(row.abrasive).toBeNull();
    }
  });
});

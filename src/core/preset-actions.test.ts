import {describe,it,expect} from 'vitest';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readJob} from './job';
import {applyJobMaterial} from './job-ops';
import {initialMaterialLibrary,deleteMaterialPreset,saveMaterialPreset,extendMaterialLibrary} from './material-library';
import {readLibraryFile,writeLibraryFile} from '../desktop/material-library';

describe('preset actions',()=>{
  it('keeps placements for the same stock/thickness even with a different quality or material ID',async()=>{
    const job=readJob(JSON.parse(await readFile('fixtures/posting/two-sheets.wam','utf8')));
    const preset=initialMaterialLibrary().materials.find(m=>m.id==='pro-0-0.02-medium')!;
    const next=applyJobMaterial(job,{kind:'sheet',id:job.sheets[0].id},preset);
    expect(next.sheets[0].materialId).toBe(preset.id);
    expect(next.sheets[0].placements).toEqual(job.sheets[0].placements);
    expect(next.sheets[1]).toEqual(job.sheets[1]);
    expect(next.parts).toEqual(job.parts);
    expect(job.sheets[0].materialId).not.toBe(preset.id);
    const incompatible=applyJobMaterial(job,{kind:'sheet',id:job.sheets[0].id},{...preset,id:'thicker',thickness:6});
    expect(incompatible.sheets[0].placements).toHaveLength(0);
    expect(incompatible.parts).toEqual(job.parts);
  });
  it('applies references to the chosen part without changing another sheet snapshot',async()=>{
    const job=readJob(JSON.parse(await readFile('fixtures/posting/two-sheets.wam','utf8')));
    const preset=initialMaterialLibrary().materials.find(m=>m.id==='pro-0-0.02-medium')!;
    const next=applyJobMaterial(job,{kind:'part',id:job.parts[0].id},preset);
    expect(next.parts[0].materialId).toBe(preset.id);
    expect(next.sheets).toEqual(job.sheets);
    expect(next.materials.find(m=>m.id===preset.id)?.feed).toBe(preset.feed);
  });
  it('persists built-in and generated-profile deletions through file reloads and restores explicitly saved references',async()=>{
    const folder=await mkdtemp(path.join(tmpdir(),'wam-deleted-presets-'));
    try{
      const library=initialMaterialLibrary(), file=path.join(folder,'presets.json');
      const reference=library.materials.find(m=>m.id==='pro-0-0.02-medium')!;
      const feed=library.materials.find(m=>m.machine==='desktop'&&m.source?.startsWith('WAM Desktop demo feed capture'))!;
      const deleted=deleteMaterialPreset(deleteMaterialPreset(library,reference.id),feed.id);
      await writeLibraryFile(file,deleted);
      const loaded=await readLibraryFile(file);
      expect(loaded.materials.some(m=>m.id===reference.id||m.id===feed.id)).toBe(false);
      expect(extendMaterialLibrary(loaded).materials.some(m=>m.id===reference.id||m.id===feed.id)).toBe(false);
      const restored=saveMaterialPreset(loaded,reference);
      expect(restored.deletedMaterialIds).not.toContain(reference.id);
      await writeLibraryFile(file,restored);
      expect((await readLibraryFile(file)).materials.filter(m=>m.id===reference.id)).toEqual([reference]);
      expect(library.materials).toContainEqual(reference);
    }finally{await rm(folder,{recursive:true,force:true});}
  },20000);
});

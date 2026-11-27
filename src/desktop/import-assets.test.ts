import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {writeLibraryFile,readLibraryFile} from './material-library';
import {initialMaterialLibrary} from '../core/material-library';
const require=createRequire(import.meta.url);
const {resolveLocalImportAsset}=require('../../electron/import-assets.cjs');
describe('local import assets and settings',()=>{
  it('embeds adjacent artwork while rejecting directory traversal and remote resources',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'wam-import-assets-'));
    try{
      await mkdir(path.join(root,'drawing'));const source=path.join(root,'drawing','part.svg');
      await writeFile(source,'<svg/>');await writeFile(path.join(root,'drawing','ring.png'),new Uint8Array([137,80,78,71]));
      await writeFile(path.join(root,'secret.png'),'outside');
      expect(await resolveLocalImportAsset(source,'ring.png?v=2')).toBe('data:image/png;base64,iVBORw==');
      expect(await resolveLocalImportAsset(source,'../secret.png')).toBeNull();
      expect(await resolveLocalImportAsset(source,'https://example.com/ring.png')).toBeNull();
      expect(await resolveLocalImportAsset(source,'missing.png')).toBeNull();
    }finally{if(path.dirname(path.resolve(root))!==path.resolve(tmpdir()))throw Error('Unexpected temporary directory');await rm(root,{recursive:true,force:true});}
  });
  it('persists import tolerance without changing machine settings or saved geometry',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'wam-import-settings-'));
    try{
      const library=initialMaterialLibrary();library.importSettings={curveToleranceMm:.025,traceDpi:1200,traceThreshold:180};
      const file=path.join(root,'library.json');await writeLibraryFile(file,library);const loaded=await readLibraryFile(file);
      expect(loaded.importSettings).toEqual(library.importSettings);expect(loaded.machines).toEqual(library.machines);
    }finally{if(path.dirname(path.resolve(root))!==path.resolve(tmpdir()))throw Error('Unexpected temporary directory');await rm(root,{recursive:true,force:true});}
  },20000);
});

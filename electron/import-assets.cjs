const fs=require('node:fs/promises');
const path=require('node:path');
const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp','.svg':'image/svg+xml','.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2'};
async function resolveLocalImportAsset(selectedFile,reference){
  if(typeof selectedFile!=='string'||typeof reference!=='string'||reference.length>4096||!selectedFile)return null;
  if(/^(?:https?:|data:|blob:)/i.test(reference))return null;
  const root=await fs.realpath(path.dirname(selectedFile));
  let ref;try{ref=decodeURIComponent(reference.split(/[?#]/)[0].replace(/^file:\/\/\//i,'').replace(/^['"]|['"]$/g,''));}catch{return null;}
  const target=path.resolve(root,ref),relative=path.relative(root,target);
  if(relative.startsWith('..')||path.isAbsolute(relative))return null;
  let actual;try{actual=await fs.realpath(target);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  const realRelative=path.relative(root,actual);if(realRelative.startsWith('..')||path.isAbsolute(realRelative))return null;
  const type=mime[path.extname(actual).toLowerCase()];if(!type)return null;
  const stat=await fs.stat(actual);if(!stat.isFile()||stat.size>10000000)throw Error('Referenced artwork exceeds the 10 MB asset limit.');
  return `data:${type};base64,${(await fs.readFile(actual)).toString('base64')}`;
}
function registerImportAssets({ipcMain,win}){
  ipcMain.handle('wam:import-asset',(event,file,reference)=>{
    if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Import asset request rejected');
    return resolveLocalImportAsset(file,reference);
  });
}
module.exports={registerImportAssets,resolveLocalImportAsset};

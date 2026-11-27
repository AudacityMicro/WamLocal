import type {ImportSettings} from './import-settings';
export type RasterAsset={width:number;height:number;data:Uint8ClampedArray};
export type AssetResolver=(reference:string)=>Promise<string|null>;
export async function embedSvgAssets(source:string,resolve:AssetResolver):Promise<string>{
  const doc=new DOMParser().parseFromString(source,'image/svg+xml');
  for(const element of Array.from(doc.querySelectorAll('a')))for(const a of Array.from(element.attributes))if(/href/i.test(a.name))element.removeAttributeNode(a);
  for(const image of Array.from(doc.querySelectorAll('image,feImage'))){
    const href=image.getAttribute('href')??image.getAttributeNS('http://www.w3.org/1999/xlink','href');
    if(href&&!href.startsWith('#')&&!href.startsWith('data:')){
      const embedded=await resolve(href);if(!embedded)throw Error(`Referenced SVG image is unavailable: ${href}. Keep the image beside the drawing or include it in the upload.`);
      image.removeAttributeNS('http://www.w3.org/1999/xlink','href');image.setAttribute('href',embedded);
    }
  }
  for(const style of Array.from(doc.querySelectorAll('style'))){
    let css=style.textContent??'';
    for(const match of [...css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)]){
      if(match[1].startsWith('#')||match[1].startsWith('data:'))continue;
      const embedded=await resolve(match[1]);if(!embedded)throw Error(`Referenced SVG resource is unavailable: ${match[1]}. Embed the resource or keep it beside the drawing.`);
      css=css.replace(match[0],`url("${embedded}")`);
    }
    style.textContent=css;
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
export async function decodeRaster(dataUrl:string):Promise<RasterAsset>{
  if(!/^data:image\//i.test(dataUrl))throw Error('Artwork asset is not an embedded image.');
  const image=new Image();await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Image decoding timed out.')),20000);image.onload=()=>{clearTimeout(timeout);resolve();};image.onerror=()=>{clearTimeout(timeout);reject(Error('Artwork image could not be decoded.'));};image.src=dataUrl;});
  if(!image.naturalWidth||!image.naturalHeight)throw Error('Artwork image has no pixels.');
  const shrink=Math.min(1,8192/image.naturalWidth,8192/image.naturalHeight,Math.sqrt(16000000/(image.naturalWidth*image.naturalHeight)));
  const width=Math.max(1,Math.floor(image.naturalWidth*shrink)),height=Math.max(1,Math.floor(image.naturalHeight*shrink)),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Image tracing requires browser canvas support.');ctx.drawImage(image,0,0,width,height);
  return {width,height,data:ctx.getImageData(0,0,width,height).data};
}
export async function loadDxfImages(source:string,resolve:AssetResolver):Promise<Map<string,RasterAsset>>{
  const lines=source.split(/\r\n|\r|\n/),images=new Map<string,RasterAsset>();
  for(let i=0;i+1<lines.length;i+=2)if(Number(lines[i])===0&&lines[i+1].trim()==='IMAGEDEF'){
    let name='',handle='';for(let j=i+2;j+1<lines.length&&Number(lines[j])!==0;j+=2){if(Number(lines[j])===1)name=lines[j+1].trim();if(Number(lines[j])===5)handle=lines[j+1].trim();}
    if(!handle||!name)continue;
    const data=name.startsWith('data:')?name:await resolve(name);if(!data)throw Error(`DXF image is unavailable: ${name}. Keep the image beside the drawing or include it in the upload.`);
    images.set(handle,await decodeRaster(data));
  }
  return images;
}
export function fileDataUrl(file:File){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error(`Could not read artwork ${file.name}`));reader.readAsDataURL(file);});}

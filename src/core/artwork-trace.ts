import type {Contour,Point} from './model';
import type {ImportSettings} from './import-settings';

function segmentDistance(p:Point,a:Point,b:Point){const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
function simplifyOpen(points:Point[],tol:number){
  if(points.length<3)return points;
  const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
  while(stack.length){const [a,b]=stack.pop()!;let worst=tol,index=-1;for(let i=a+1;i<b;i++){const d=segmentDistance(points[i],points[a],points[b]);if(d>worst){worst=d;index=i;}}if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}}
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}

/** Trace dark pixels as closed boundaries, preserving transparent/white holes.
 * Physical curve tolerance controls simplification; it cannot restore lost pixels. */
export function tracePixels(data:Uint8ClampedArray,width:number,height:number,scaleX:number,scaleY:number,settings:ImportSettings):Contour[]{
  if(width*height>16000000||data.length!==width*height*4)throw Error('Artwork tracing image exceeds its pixel limit.');
  const ink=new Uint8Array(width*height);
  for(let i=0;i<ink.length;i++){const a=data[4*i+3]/255,lum=.2126*data[4*i]+.7152*data[4*i+1]+.0722*data[4*i+2];ink[i]=a*lum+(1-a)*255<settings.traceThreshold?1:0;}
  const edges=new Map<number,number[]>(),stride=width+1;let edgeCount=0;
  const add=(a:number,b:number)=>{if(++edgeCount>1000000)throw Error('Artwork has too many boundaries; reduce tracing DPI or adjust the darkness threshold.');const list=edges.get(a)??[];list.push(b);edges.set(a,list);};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(ink[y*width+x]){
    const tl=y*stride+x,tr=tl+1,bl=tl+stride,br=bl+1;
    if(y===0||!ink[(y-1)*width+x])add(tl,tr);
    if(x===width-1||!ink[y*width+x+1])add(tr,br);
    if(y===height-1||!ink[(y+1)*width+x])add(br,bl);
    if(x===0||!ink[y*width+x-1])add(bl,tl);
  }
  const point=(key:number):Point=>({x:key%stride,y:Math.floor(key/stride)}),result:Contour[]=[];
  while(edges.size){
    const start=edges.keys().next().value!;let prev=start,current=edges.get(start)!.pop()!;if(!edges.get(start)!.length)edges.delete(start);
    const loop=[point(start)];let steps=0;
    while(current!==start){
      if(++steps>1000000)throw Error('Artwork boundary is too complex.');
      loop.push(point(current));const choices=edges.get(current);if(!choices?.length)throw Error('Artwork boundary could not be closed.');
      const a=point(prev),b=point(current),dx=b.x-a.x,dy=b.y-a.y;
      const rank=(key:number)=>{const c=point(key),ex=c.x-b.x,ey=c.y-b.y,cross=dx*ey-dy*ex,dot=dx*ex+dy*ey;return cross>0?3:dot>0?2:cross<0?1:0;};
      let index=0;for(let i=1;i<choices.length;i++)if(rank(choices[i])>rank(choices[index]))index=i;
      const next=choices.splice(index,1)[0];if(!choices.length)edges.delete(current);prev=current;current=next;
    }
    const physical=loop.map(p=>({x:p.x*scaleX,y:p.y*scaleY}));
    let split=1;for(let i=2;i<physical.length;i++)if(Math.hypot(physical[i].x-physical[0].x,physical[i].y-physical[0].y)>Math.hypot(physical[split].x-physical[0].x,physical[split].y-physical[0].y))split=i;
    const points=[...simplifyOpen(physical.slice(0,split+1),settings.curveToleranceMm).slice(0,-1),...simplifyOpen([...physical.slice(split),physical[0]],settings.curveToleranceMm).slice(0,-1)];
    if(points.length>20000)throw Error('Artwork contour exceeds 20,000 points; increase curve tolerance or reduce tracing DPI.');
    if(points.length>=3)result.push({points,closed:true,hole:false});
    if(result.length>1000)throw Error('Artwork contains more than 1,000 outlines. Adjust the tracing threshold/resolution or split the image.');
  }
  return result;
}

export function traceDxfText(entity:any,mmPerUnit:number,settings:ImportSettings):Contour[]{
  const raw=String(entity.text??'').replace(/\\U\+([0-9a-f]{4})/gi,(_,n)=>String.fromCharCode(parseInt(n,16))).replace(/%%d/gi,'°').replace(/%%p/gi,'±').replace(/%%c/gi,'Ø');
  const text=raw.replace(/\\P/gi,'\n').replace(/\\[A-Za-z][^;]*;/g,'').replace(/[{}]/g,'');
  if(!text.trim())return [];
  const height=entity.textHeight??entity.height??1;if(!Number.isFinite(height)||height<=0)throw Error('DXF text height is invalid.');
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Text outlining requires browser canvas support.');
  let pixelsPerUnit=mmPerUnit*settings.traceDpi/25.4,fontSize=height*pixelsPerUnit;
  ctx.font=`${fontSize}px Arial`;
  const cap=ctx.measureText('M').actualBoundingBoxAscent||fontSize*.72;fontSize*=height*pixelsPerUnit/cap;
  let lines=text.split('\n');
  ctx.font=`${fontSize}px Arial`;
  if(entity.type==='MTEXT'&&entity.width>0){const limit=entity.width*pixelsPerUnit;lines=lines.flatMap(line=>{const result:string[]=[];let current='';for(const word of line.split(/\s+/)){const candidate=current?current+' '+word:word;if(current&&ctx.measureText(candidate).width>limit){result.push(current);current=word;}else current=candidate;}result.push(current);return result;});}
  const ascent=Math.max(...lines.map(line=>ctx.measureText(line).actualBoundingBoxAscent||fontSize)),descent=Math.max(...lines.map(line=>ctx.measureText(line).actualBoundingBoxDescent||0));
  let width=Math.max(...lines.map(line=>ctx.measureText(line).width))+8,pxHeight=ascent+descent+(lines.length-1)*fontSize*1.2+8;
  const shrink=Math.min(1,8192/width,8192/pxHeight,Math.sqrt(16000000/(width*pxHeight)));
  pixelsPerUnit*=shrink;fontSize*=shrink;width=Math.ceil(width*shrink);pxHeight=Math.ceil(pxHeight*shrink);
  canvas.width=Math.max(1,width);canvas.height=Math.max(1,pxHeight);ctx.font=`${fontSize}px Arial`;ctx.fillStyle='black';ctx.textBaseline='alphabetic';
  const baseline=ascent*shrink+4;lines.forEach((line,i)=>ctx.fillText(line,4,baseline+i*fontSize*1.2));
  const contours=tracePixels(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,1/pixelsPerUnit,1/pixelsPerUnit,{...settings,curveToleranceMm:settings.curveToleranceMm/mmPerUnit});
  const pos=entity.type==='MTEXT'?entity.position:entity.halign?entity.endPoint??entity.startPoint:entity.startPoint;
  const measured=Math.max(...lines.map(line=>ctx.measureText(line).width))/pixelsPerUnit;
  const h=entity.type==='MTEXT'?((entity.attachmentPoint??1)-1)%3:entity.halign??0;
  const v=entity.type==='MTEXT'?Math.floor(((entity.attachmentPoint??1)-1)/3):entity.valign===3?0:entity.valign===2?1:2;
  const shiftX=h===1?-measured/2:h===2?-measured:0;
  const shiftY=entity.type==='MTEXT'||entity.valign? (v===0?-height:v===1?-height/2:0):0;
  const angle=entity.directionVector?Math.atan2(entity.directionVector.y,entity.directionVector.x):(entity.rotation??0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),sx=entity.xScale??1;
  return contours.map(c=>({...c,points:c.points.map(p=>{const x=(p.x-4/pixelsPerUnit+shiftX)*sx,y=baseline/pixelsPerUnit-p.y+shiftY;return {x:(pos?.x??0)+cos*x-sin*y,y:(pos?.y??0)+sin*x+cos*y};})}));
}

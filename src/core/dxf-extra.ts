import type DxfParser from 'dxf-parser';
import type {Contour,Point} from './model';
import {flattenDxfPolyline} from './dxf-polyline';
import {flattenDxfSpline} from './dxf-spline';
type Group={code:number,value:any};

/** Capture entity types the upstream parser otherwise silently discards. */
export function registerExtraDxfEntities(parser:DxfParser,source:string){
  const known=new Set(['POINT','3DFACE','ARC','ATTDEF','CIRCLE','DIMENSION','ELLIPSE','INSERT','LINE','LWPOLYLINE','MTEXT','POLYLINE','SOLID','SPLINE','TEXT','VERTEX','SEQEND','SECTION','ENDSEC','EOF','BLOCK','ENDBLK','TABLE','ENDTAB']);
  const lines=source.split(/\r\n|\r|\n/),extra=new Set<string>();
  for(let i=0;i+1<lines.length;i+=2)if(Number(lines[i].trim())===0){const name=lines[i+1].trim();if(!known.has(name))extra.add(name);}
  for(const name of extra)parser.registerEntityHandler(class {
    ForEntityName=name as any;
    parseEntity(scanner:{next():Group;isEOF():boolean}):any {
      const e:any={type:name,rawGroups:[]};while(!scanner.isEOF()){const g=scanner.next();if(g.code===0)break;e.rawGroups.push(g);if(g.code===5)e.handle=g.value;if(g.code===8)e.layer=g.value;}
      if(name==='ATTRIB')Object.assign(e,{text:value(e.rawGroups,1,''),textHeight:value(e.rawGroups,40,1),xScale:value(e.rawGroups,41,1),rotation:value(e.rawGroups,50,0),startPoint:point(e.rawGroups,10),endPoint:point(e.rawGroups,11),halign:value(e.rawGroups,72,0),valign:value(e.rawGroups,74,0)});
      if(name==='TRACE')e.points=[10,11,12,13].map(c=>point(e.rawGroups,c)).filter(Boolean);
      if(name==='LEADER'||name==='MLINE'){e.vertices=[];const code=name==='LEADER'?10:11;for(let i=0;i<e.rawGroups.length;i++)if(e.rawGroups[i].code===code)e.vertices.push(point(e.rawGroups.slice(i,i+3),code));}
      return e;
    }
  });
}
const value=(g:Group[],code:number,fallback?:any)=>g.find(v=>v.code===code)?.value??fallback;
const point=(g:Group[],code:number):any=>{const x=value(g,code);return x===undefined?undefined:{x:Number(x),y:Number(value(g,code+10,0)),z:Number(value(g,code+20,0))};};

export function hatchContours(groups:Group[],mmPerUnit:number,toleranceMm:number):Contour[]{
  const loops:Contour[]=[];
  const first=groups.findIndex(g=>g.code===91);if(first<0)throw Error('DXF HATCH has no boundary paths.');
  let cursor=first+1;
  while(cursor<groups.length){
    if(groups[cursor].code!==92){cursor++;continue;}
    const flag=Number(groups[cursor++].value),start=cursor;while(cursor<groups.length&&groups[cursor].code!==92)cursor++;
    const loop=groups.slice(start,cursor);
    if(flag&2){
      const vertices:any[]=[],count=Number(value(loop,93,0));for(let i=0;i<loop.length&&vertices.length<count;i++)if(loop[i].code===10){const p=point(loop.slice(i,i+3),10);let j=i+1;while(j<loop.length&&loop[j].code!==10&&loop[j].code!==97){if(loop[j].code===42)p.bulge=Number(loop[j].value);j++;}vertices.push(p);}
      if(vertices.length<2)throw Error('DXF HATCH polyline has no boundary.');
      loops.push({points:flattenDxfPolyline(vertices,true,mmPerUnit,toleranceMm),closed:true,hole:false});continue;
    }
    const pieces:Point[][]=[];
    const countIndex=loop.findIndex(g=>g.code===93);if(countIndex<0)throw Error('DXF HATCH boundary has no edge count.');
    let at=countIndex+1;
    while(at<loop.length){
      if(loop[at].code===97||loop[at].code===98)break;
      if(loop[at].code!==72){at++;continue;}
      const kind=Number(loop[at++].value),edgeStart=at;while(at<loop.length&&loop[at].code!==72&&loop[at].code!==97)at++;
      const edge=loop.slice(edgeStart,at);
      if(kind===1){pieces.push([point(edge,10),point(edge,11)]);continue;}
      if(kind===2||kind===3){
        const center=point(edge,10),major=kind===3?point(edge,11):{x:Number(value(edge,40)),y:0},ratio=kind===3?Number(value(edge,40)):1;
        const radius=Math.hypot(major.x,major.y),start=Number(value(edge,50,0))*Math.PI/180,end=Number(value(edge,51,360))*Math.PI/180,ccw=!!value(edge,73,1);
        let span=ccw?end-start:start-end;if(span<=0)span+=2*Math.PI;
        const count=Math.max(4,Math.ceil(span/Math.sqrt(8*toleranceMm/(radius*mmPerUnit))));
        if(!Number.isFinite(count)||count>20000||radius<=0||ratio<=0||ratio>1)throw Error('DXF HATCH has an invalid or excessively detailed curved edge.');
        pieces.push(Array.from({length:count+1},(_,i)=>{const t=start+(ccw?1:-1)*span*i/count;return {x:center.x+major.x*Math.cos(t)-major.y*ratio*Math.sin(t),y:center.y+major.y*Math.cos(t)+major.x*ratio*Math.sin(t)};}));continue;
      }
      if(kind===4){
        const controls:any[]=[];for(let i=0;i<edge.length;i++)if(edge[i].code===10)controls.push(point(edge.slice(i,i+3),10));
        pieces.push(flattenDxfSpline({degreeOfSplineCurve:Number(value(edge,94)),controlPoints:controls,knotValues:edge.filter(g=>g.code===40).map(g=>Number(g.value)),weights:edge.filter(g=>g.code===42).map(g=>Number(g.value))},mmPerUnit,toleranceMm));continue;
      }
      throw Error(`Unsupported DXF HATCH edge type ${kind}.`);
    }
    if(!pieces.length)throw Error('DXF HATCH boundary is empty.');
    const joined=[...pieces.shift()!],epsilon=Math.max(1e-8,1e-5/mmPerUnit);
    while(pieces.length){const last=joined.at(-1)!;const close=(p:Point)=>p&&Math.hypot(p.x-last.x,p.y-last.y)<=epsilon;
      const i=pieces.findIndex(p=>close(p[0])||close(p.at(-1)!));if(i<0)throw Error('DXF HATCH has disconnected boundary edges.');
      const next=pieces.splice(i,1)[0];if(!close(next[0]))next.reverse();joined.push(...next.slice(1));
    }
    if(Math.hypot(joined[0].x-joined.at(-1)!.x,joined[0].y-joined.at(-1)!.y)>epsilon)throw Error('DXF HATCH boundary is not closed.');
    joined.pop();loops.push({points:joined,closed:true,hole:false});
  }
  return loops;
}

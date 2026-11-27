import type {Point} from './model';
import {DEFAULT_IMPORT_TOLERANCE_MM,importTolerance} from './import-settings';

type Vec = Point & {z?:number};
export type DxfSpline = {
  controlPoints: Vec[]; knotValues:number[]; weights?:number[];
  degreeOfSplineCurve:number; closed?:boolean; periodic?:boolean;
  normalVector?:Vec;
  fitPoints?:Vec[];startTangent?:Vec;endTangent?:Vec;
};
type H = [number,number,number];

/** The upstream parser discards group 41 (NURBS weights). Keep them here.
 * https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-E1F884F8-AA90-4864-A215-3182D47A9C74.htm */
export class WeightedSplineParser {
  ForEntityName = 'SPLINE' as const;
  parseEntity(scanner:{next():{code:number,value:unknown};isEOF():boolean}):any {
    const e:any={type:'SPLINE',controlPoints:[],fitPoints:[],knotValues:[],weights:[]};
    let cp:any,fp:any;
    while(!scanner.isEOF()) {
      const g=scanner.next(), n=Number(g.value);
      if(g.code===0)break;
      switch(g.code){
        case 5:e.handle=g.value;break;
        case 8:e.layer=g.value;break;
        case 10:cp={x:n,y:NaN,z:0};e.controlPoints.push(cp);break;
        case 20:if(cp)cp.y=n;break;
        case 30:if(cp)cp.z=n;break;
        case 11:fp={x:n,y:NaN,z:0};e.fitPoints.push(fp);break;
        case 21:if(fp)fp.y=n;break;
        case 31:if(fp)fp.z=n;break;
        case 12:e.startTangent={x:n,y:0,z:0};break;
        case 22:if(e.startTangent)e.startTangent.y=n;break;
        case 32:if(e.startTangent)e.startTangent.z=n;break;
        case 13:e.endTangent={x:n,y:0,z:0};break;
        case 23:if(e.endTangent)e.endTangent.y=n;break;
        case 33:if(e.endTangent)e.endTangent.z=n;break;
        case 40:e.knotValues.push(n);break;
        case 41:e.weights.push(n);break;
        case 70:e.closed=!!(n&1);e.periodic=!!(n&2);break;
        case 71:e.degreeOfSplineCurve=n;break;
        case 210:e.normalVector={x:n,y:0,z:1};break;
        case 220:(e.normalVector??={x:0,y:0,z:1}).y=n;break;
        case 230:(e.normalVector??={x:0,y:0,z:1}).z=n;break;
      }
    }
    return e;
  }
}

function prepared(s:DxfSpline) {
  if(!s.controlPoints?.length&&s.fitPoints?.length)s=reconstructFitSpline(s);
  const p=s.degreeOfSplineCurve, points=s.controlPoints??[],u=s.knotValues??[];
  if(!Number.isInteger(p)||p<1||p>10||points.length<=p||u.length!==points.length+p+1)
    throw Error('DXF SPLINE needs valid control or fit points, degree (1–10), and knots.');
  if(points.some(v=>!Number.isFinite(v.x)||!Number.isFinite(v.y)||!Number.isFinite(v.z??0))||u.some((v,i)=>!Number.isFinite(v)||(i>0&&v<u[i-1])))
    throw Error('DXF SPLINE contains invalid coordinates or knots.');
  if(points.some(v=>Math.abs((v.z??0)-(points[0].z??0))>1e-8)||Math.abs(s.normalVector?.x??0)>1e-8||Math.abs(s.normalVector?.y??0)>1e-8)
    throw Error('Tilted or non-planar DXF SPLINE: export a flat XY outline.');
  const weights=s.weights?.length?s.weights:points.map(()=>1);
  if(weights.length!==points.length||weights.some(w=>!Number.isFinite(w)||w<=0))throw Error('DXF SPLINE needs one positive rational weight per control point.');
  const start=u[p],end=u[points.length];
  if(!(end>start))throw Error('DXF SPLINE has an empty parameter range.');
  return {p,u,start,end,h:points.map((v,i)=>[v.x*weights[i],v.y*weights[i],weights[i]] as H)};
}

/** Fit-only DXF does not carry a control polygon. Reconstruct a centripetal
 * cubic through its fit points, honoring supplied end-tangent directions. */
function reconstructFitSpline(s:DxfSpline):DxfSpline {
  const points=(s.fitPoints??[]).filter((p,i,a)=>!i||Math.hypot(p.x-a[i-1].x,p.y-a[i-1].y)>1e-12);
  if(points.length<2)throw Error('DXF SPLINE needs at least two distinct fit points.');
  const closed=!!(s.closed||s.periodic);
  if(closed&&Math.hypot(points[0].x-points.at(-1)!.x,points[0].y-points.at(-1)!.y)>1e-10)points.push(points[0]);
  const intervals=points.slice(1).map((p,i)=>Math.sqrt(Math.hypot(p.x-points[i].x,p.y-points[i].y)));
  const derivative=(i:number):Vec=>{
    const count=points.length-1;
    if(!closed&&(i===0||i===count)){
      const a=i?points[i-1]:points[0],b=i?points[i]:points[1],dt=intervals[i?i-1:0];
      const supplied=i?s.endTangent:s.startTangent,mag=supplied?Math.hypot(supplied.x,supplied.y):0,speed=Math.hypot(b.x-a.x,b.y-a.y)/dt;
      return mag?{x:supplied!.x/mag*speed,y:supplied!.y/mag*speed}:{x:(b.x-a.x)/dt,y:(b.y-a.y)/dt};
    }
    const index=i===count?0:i,prev=index===0?count-1:index-1,next=index+1;
    const before=intervals[prev],after=intervals[index],a=points[prev],b=points[index],c=points[next];
    return {x:((b.x-a.x)/before*after+(c.x-b.x)/after*before)/(before+after),y:((b.y-a.y)/before*after+(c.y-b.y)/after*before)/(before+after)};
  };
  const control:Vec[]=[points[0]],knots=[0,0,0,0];
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],da=derivative(i),db=derivative(i+1),dt=intervals[i]/3;
    control.push({x:a.x+da.x*dt,y:a.y+da.y*dt,z:a.z},{x:b.x-db.x*dt,y:b.y-db.y*dt,z:b.z},b);
    knots.push(...Array(i===points.length-2?4:3).fill(i+1));
  }
  return {...s,degreeOfSplineCurve:3,controlPoints:control,knotValues:knots,weights:undefined};
}

function at(h:H[],u:number[],p:number,t:number,span?:number):H {
  let k=span??h.length-1;
  if(span===undefined&&t<u[h.length]){let low=p,high=h.length;while(low+1<high){const mid=(low+high)>>1;if(u[mid]<=t)low=mid;else high=mid;}k=low;}
  const d=h.slice(k-p,k+1).map(v=>[...v] as H);
  for(let r=1;r<=p;r++)for(let j=p;j>=r;j--){const i=k-p+j,den=u[i+p-r+1]-u[i],a=den?(t-u[i])/den:0;for(let c=0;c<3;c++)d[j][c]=(1-a)*d[j-1][c]+a*d[j][c];}
  return d[p];
}
const xy=(h:H):Point=>({x:h[0]/h[2],y:h[1]/h[2]});
export function evaluateDxfSpline(s:DxfSpline,t:number):Point {const v=prepared(s);if(t<v.start||t>v.end)throw Error('SPLINE parameter is outside its knot domain.');return xy(at(v.h,v.u,v.p,t));}

function inverse(matrix:number[][]) {
  const n=matrix.length,a=matrix.map((row,i)=>[...row,...Array.from({length:n},(_,j)=>i===j?1:0)]);
  for(let i=0;i<n;i++){
    let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;
    [a[i],a[pivot]]=[a[pivot],a[i]];
    const v=a[i][i];if(Math.abs(v)<1e-14)throw Error('DXF SPLINE span cannot be resolved.');
    for(let c=0;c<2*n;c++)a[i][c]/=v;
    for(let j=0;j<n;j++)if(j!==i){const factor=a[j][i];for(let c=0;c<2*n;c++)a[j][c]-=factor*a[i][c];}
  }
  return a.map(row=>row.slice(n));
}
const basisCache=new Map<number,number[][]>();
function basisInverse(p:number) {
  if(!basisCache.has(p)){
    const choose=(n:number,k:number)=>{let v=1;for(let j=1;j<=k;j++)v=v*(n-j+1)/j;return v;};
    basisCache.set(p,inverse(Array.from({length:p+1},(_,i)=>Array.from({length:p+1},(_,j)=>choose(p,j)*(i/p)**j*(1-i/p)**(p-j)))));
  }
  return basisCache.get(p)!;
}
function chordDistance(p:Point,a:Point,b:Point) {const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}

/** Each knot span is a rational Bezier. Its positive-weight control hull
 * bounds the flattening error; subdivision also handles periodic/clamped ends. */
export function flattenDxfSpline(s:DxfSpline,mmPerUnit:number,toleranceMm=DEFAULT_IMPORT_TOLERANCE_MM):Point[] {
  if(!Number.isFinite(mmPerUnit)||mmPerUnit<=0)throw Error('Invalid DXF spline scale.');
  const {p,u,h,start,end}=prepared(s),tolerance=importTolerance(toleranceMm)/mmPerUnit,points:Point[]=[];
  const append=(q:Point)=>{if(!Number.isFinite(q.x)||!Number.isFinite(q.y))throw Error('DXF SPLINE produced invalid geometry.');if(!points.length||Math.hypot(q.x-points.at(-1)!.x,q.y-points.at(-1)!.y)>1e-12)points.push(q);if(points.length>20000)throw Error('DXF SPLINE exceeds the 20,000 point curve limit.');};
  const subdivide=(control:H[],depth:number)=>{
    if(control.some(v=>v[2]<=0))throw Error('DXF SPLINE span has invalid rational weights.');
    const projected=control.map(xy),a=projected[0],b=projected.at(-1)!;
    if(projected.every(q=>chordDistance(q,a,b)<=tolerance)){append(b);return;}
    if(depth>=28)throw Error('DXF SPLINE cannot meet the curve tolerance.');
    let level=control;const left=[level[0]],right=[level.at(-1)!];
    while(level.length>1){level=level.slice(1).map((v,i)=>v.map((c,j)=>(c+level[i][j])/2) as H);left.push(level[0]);right.unshift(level.at(-1)!);}
    subdivide(left,depth+1);subdivide(right,depth+1);
  };
  const inv=basisInverse(p);
  for(let k=p;k<h.length;k++){
    const a=u[k],b=u[k+1];if(!(b>a))continue;
    if(a>start&&u.filter(v=>v===a).length>p)throw Error('Discontinuous DXF SPLINE: split at its repeated knots before importing.');
    const samples=Array.from({length:p+1},(_,i)=>at(h,u,p,a+(b-a)*i/p,k));
    const control=inv.map(row=>[0,1,2].map(c=>row.reduce((sum,w,i)=>sum+w*samples[i][c],0)) as H);
    if(!points.length)append(xy(control[0]));
    subdivide(control,0);
  }
  if((s.closed||s.periodic)&&Math.hypot(points[0].x-points.at(-1)!.x,points[0].y-points.at(-1)!.y)>tolerance)
    throw Error('Closed DXF SPLINE has disconnected endpoints.');
  return points;
}

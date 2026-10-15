import { MseError } from './document.mjs';
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(a,b)=>a.map(x=>x*b);
const length=a=>Math.sqrt(a[0]*a[0]+a[1]*a[1]);

// SymbolShape::after_reading normalizes old unversioned files per shape,
// after enforcing handle locks and measuring the actual curve bounds.
export function prepareVectorSymbol(symbol) {
  const legacy=!symbol.version||/^0(?:[.-]0){0,2}$/.test(symbol.version);
  const prepare=part=>{
    if(part.type!=='shape')return {...part,parts:part.parts.map(prepare)};
    const shape=constrainSymbolShape(part);
    if(!legacy)return shape;
    const bounds=symbolShapeBounds(shape);
    if(bounds.max[0]<100||bounds.max[1]<100)return shape;
    return {...shape,name:shape.name||'Shape',points:shape.points.map(point=>({...point,
      position:point.position.map(v=>v/500),before:point.before.map(v=>v/500),after:point.after.map(v=>v/500),
    }))};
  };
  return {...symbol,parts:symbol.parts.map(prepare)};
}

export function constrainSymbolShape(shape) {
  return {...shape,points:shape.points.map(p=>{
    let before=[...p.before],after=[...p.after];
    if(p.lock==='size'){before=mul(sub(before,after),0.5);after=mul(before,-1);}
    else if(p.lock==='direction'){
      const delta=sub(before,after),size=length(delta);
      if(!size)throw new MseError('symbol-geometry','Direction-locked handles have no direction');
      const direction=mul(delta,1/size);
      before=mul(direction,length(before));after=mul(direction,-length(after));
    }
    return {...p,position:[...p.position],before,after};
  })};
}

// Matches segment_subdivide / curve_subdivide's fixed depth and threshold.
// MSE recurses even when this midpoint does not pass the emission threshold.
export function symbolShapePolygon(shape,{transform=p=>p}={}) {
  const points=constrainSymbolShape(shape).points,polygon=[];
  const emit=p=>polygon.push(transform(p));
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length];emit(p.position);
    if(p.segment!=='curve')continue;
    const c=mul(p.after,3),b=sub(mul(sub(add(q.position,q.before),add(p.position,p.after)),3),c);
    const a=sub(sub(sub(q.position,p.position),c),b);
    const at=t=>add(mul(add(mul(add(mul(a,t),b),t),c),t),p.position);
    const recurse=(left,right,t0,t1,level)=>{
      if(!level)return;
      const t=(t0+t1)*0.5,mid=at(t),d0=sub(left,mid),d1=sub(mid,right),d=sub(left,right);
      const threshold=Math.abs(Math.atan2(d0[0],d0[1])-Math.atan2(d1[0],d1[1]))*(d[0]*d[0]+d[1]*d[1]);
      recurse(left,mid,t0,t,level-1);
      if(threshold>=0.0001)emit(mid);
      recurse(mid,right,t,t1,level-1);
    };
    recurse(p.position,q.position,0,1,5);
  }
  return polygon;
}

const emptyBounds=()=>({min:[Infinity,Infinity],max:[-Infinity,-Infinity]});
const include=(bounds,p)=>{for(let i=0;i<2;i++){bounds.min[i]=Math.min(bounds.min[i],p[i]);bounds.max[i]=Math.max(bounds.max[i],p[i]);}};
function roots(a,b,c){
  if(a===0)return b===0?(c===0?[0]:[]):[-c/b];
  const d=b*b-4*a*c;return d<0?[]:[(-b-Math.sqrt(d))/(2*a),(-b+Math.sqrt(d))/(2*a)];
}
export function symbolShapeBounds(shape,{transform=p=>p}={}) {
  const points=constrainSymbolShape(shape).points,bounds=emptyBounds();
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length],start=transform(p.position),end=transform(q.position);
    include(bounds,start);include(bounds,end);
    if(p.segment!=='curve')continue;
    const first=transform(add(p.position,p.after)),second=transform(add(q.position,q.before));
    const c=mul(sub(first,start),3),b=sub(mul(sub(second,first),3),c),a=sub(sub(sub(end,start),c),b);
    for(const t of [0,1].flatMap(i=>roots(3*a[i],2*b[i],c[i])))if(t>=0&&t<=1)include(bounds,add(mul(add(mul(add(mul(a,t),b),t),c),t),start));
  }
  return bounds;
}

export function symbolBounds(symbol) {
  const bounds=emptyBounds();
  const visit=(part,transform)=>{
    if(part.type==='shape'){
      const b=symbolShapeBounds(part,{transform});if(part.points.length){include(bounds,b.min);include(bounds,b.max);}return;
    }
    if(part.type==='symmetry'){
      const copies=part.kind==='reflection'?part.copies&~1:part.copies;
      const base=2*Math.atan2(part.handle[1],part.handle[0]);
      for(const child of part.parts)for(let i=0;i<copies;i++){
        const reflected=part.kind==='reflection'&&i%2===1,a=i*2*Math.PI/copies+(reflected?base:0),c=Math.cos(a),s=Math.sin(a);
        visit(child,p=>{const [x,y]=sub(p,part.center);return transform(add(part.center,reflected?[c*x+s*y,s*x-c*y]:[c*x-s*y,s*x+c*y]));});
      }
    }else for(const child of part.parts)visit(child,transform);
  };
  for(const part of symbol.parts)visit(part,p=>p);
  return bounds;
}
export function symbolAspectRatio(bounds) {
  const margin=i=>Math.min(0.4999,Math.max(0,Math.min(bounds.min[i],1-bounds.max[i])));
  const delta=2*(margin(1)-margin(0));return delta>0?1/(1-delta):1+delta;
}

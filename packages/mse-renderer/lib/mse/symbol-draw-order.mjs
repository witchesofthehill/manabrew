import {MseError} from './document.mjs';
// Native paints group children bottom-to-top, then each symmetry copy in
// descending order. Only the first copy may flush an overlapping shape group.
export function symbolDrawOrder(symbol,{maxShapes=65536}={}){
  const result=[];
  const visit=(part,transform,allowOverlap)=>{
    if(part.type==='shape'){
      if(result.length>=maxShapes)throw new MseError('symbol-budget','Too many expanded symbol shapes');
      result.push({shape:part,transform,allowOverlap});return;
    }
    if(part.type==='group'){
      for(const child of [...part.parts].reverse())visit(child,transform,allowOverlap);
      return;
    }
    if(part.type!=='symmetry')throw new MseError('symbol-part',`Unknown symbol part ${part.type}`);
    const copies=part.kind==='reflection'?Math.floor(part.copies/2)*2:part.copies;
    if(copies>maxShapes)throw new MseError('symbol-budget','Too many symmetry copies');
    const base=2*Math.atan2(part.handle[1],part.handle[0]);
    for(const child of [...part.parts].reverse())for(let i=copies-1;i>=0;i--){
      const reflected=part.kind==='reflection'&&i%2===1,a=i*2*Math.PI/copies+(reflected?base:0),c=Math.cos(a),s=Math.sin(a);
      visit(child,p=>{
        const x=p[0]-part.center[0],y=p[1]-part.center[1];
        return transform([part.center[0]+(reflected?c*x+s*y:c*x-s*y),part.center[1]+(reflected?s*x-c*y:s*x+c*y)]);
      },allowOverlap&&i===copies-1);
    }
  };
  for(const part of [...symbol.parts].reverse())visit(part,p=>p,true);
  return result;
}

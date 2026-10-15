import { allocateRaster, cropRaster, resizeRaster } from './image-sampling.mjs';
import { MseError } from './document.mjs';

export function nineSliceRaster(source,{width,height,left=0,right=0,top=0,bottom=0},maxPixels=16777216){
  if(![left,right,top,bottom].every(v=>Number.isSafeInteger(v)&&v>=0))throw new MseError('image-slice','Slice borders must be nonnegative integers');
  const sw=source.width,sh=source.height;
  let l=Math.min(left,sw),t=Math.min(top,sh),r=Math.min(right,sw-l),b=Math.min(bottom,sh-t);
  if(l+r>=sw && width-l-r>0){if(l>=r&&l>0)l--;else if(r>0)r--;}
  if(t+b>=sh && height-t-b>0){if(t>=b&&t>0)t--;else if(b>0)b--;}
  const output=allocateRaster(width,height,source.hasAlpha,maxPixels);
  const copy=(sx,sy,cw,ch,x,y,dw=cw,dh=ch)=>{
    if(cw<=0||ch<=0||dw<=0||dh<=0)return;
    const piece=resizeRaster(cropRaster(source,cw,ch,sx,sy,undefined,maxPixels),dw,dh,maxPixels);
    for(let py=Math.max(0,-y);py<Math.min(dh,height-y);py++)for(let px=Math.max(0,-x);px<Math.min(dw,width-x);px++){
      const from=(py*dw+px)*4,to=((py+y)*width+px+x)*4;
      output.data.set(piece.data.subarray(from,from+4),to);
    }
  };
  const mw=width-l-r,mh=height-t-b,smw=sw-l-r,smh=sh-t-b;
  // Preserve native Paste order when borders overlap in a small destination.
  copy(0,0,l,t,0,0);copy(sw-r,0,r,t,width-r,0);
  copy(0,sh-b,l,b,0,height-b);copy(sw-r,sh-b,r,b,width-r,height-b);
  copy(l,0,smw,t,l,0,mw,t);copy(l,sh-b,smw,b,l,height-b,mw,b);
  copy(0,t,l,smh,0,t,l,mh);copy(sw-r,t,r,smh,width-r,t,r,mh);
  copy(l,t,smw,smh,l,t,mw,mh);
  return output;
}

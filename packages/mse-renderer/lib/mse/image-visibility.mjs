import {allocateRaster} from './image-sampling.mjs';
import {MseError} from './document.mjs';

// Native make_visibility_mask marks pixels white when any in-bounds neighbor
// has alpha <= threshold. Separable prefix sums preserve the square footprint
// while avoiding native's quadratic work for large radii.
export function visibilityRaster(source,threshold=254,radius=1,maxPixels=16777216){
  if(!Number.isSafeInteger(threshold)||!Number.isSafeInteger(radius))throw new MseError('image-visibility','Threshold and radius must be finite integers');
  const {width,height}=source,out=allocateRaster(width,height,false,maxPixels);
  if(!source.hasAlpha)return out;
  radius=Math.max(0,Math.min(radius,Math.max(width,height)));
  const rows=new Uint8Array(width*height),prefix=new Uint32Array(Math.max(width,height)+1);
  for(let y=0;y<height;y++){
    prefix[0]=0;
    for(let x=0;x<width;x++)prefix[x+1]=prefix[x]+(source.data[(y*width+x)*4+3]<=threshold?1:0);
    for(let x=0;x<width;x++)rows[y*width+x]=prefix[Math.min(width,x+radius+1)]>prefix[Math.max(0,x-radius)]?1:0;
  }
  for(let x=0;x<width;x++){
    prefix[0]=0;
    for(let y=0;y<height;y++)prefix[y+1]=prefix[y]+rows[y*width+x];
    for(let y=0;y<height;y++){
      const value=prefix[Math.min(height,y+radius+1)]>prefix[Math.max(0,y-radius)]?255:0,i=(y*width+x)*4;
      out.data[i]=out.data[i+1]=out.data[i+2]=value;
    }
  }
  return out;
}

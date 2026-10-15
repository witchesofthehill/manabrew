import {allocateRaster} from './image-sampling.mjs';
import {MseError} from './document.mjs';

// Image fields use wxImage::Rescale's default quality, unlike generated frame
// images. Exact integer reductions use ShrinkBy; other sizes use fixed-point
// nearest-neighbor sampling. Preserve the native non-premultiplied averaging.
export function resizeArtwork(source,width,height,maxPixels=16777216){
  if(!source||!Number.isSafeInteger(source.width)||!Number.isSafeInteger(source.height)||source.width<1||source.height<1||source.data?.length!==source.width*source.height*4)throw new MseError('image-data','Expected a positive-sized RGBA artwork raster');
  if(source.width*source.height>maxPixels)throw new MseError('image-budget','Artwork exceeds pixel budget');
  const output=allocateRaster(width,height,Boolean(source.hasAlpha),maxPixels);
  if(source.width===width&&source.height===height){output.data.set(source.data);return output;}
  const xf=source.width/width,yf=source.height/height;
  if(Number.isInteger(xf)&&Number.isInteger(yf)&&xf>=1&&yf>=1){
    const count=xf*yf;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const sum=[0,0,0,0];
      for(let sy=y*yf;sy<(y+1)*yf;sy++)for(let sx=x*xf;sx<(x+1)*xf;sx++){
        const offset=(sy*source.width+sx)*4,a=source.hasAlpha?source.data[offset+3]:255;
        if(a>0)for(let c=0;c<3;c++)sum[c]+=source.data[offset+c];
        sum[3]+=a;
      }
      const offset=(y*width+x)*4;
      for(let c=0;c<4;c++)output.data[offset+c]=Math.trunc(sum[c]/count);
    }
  }else{
    const dx=Math.floor(source.width*65536/width),dy=Math.floor(source.height*65536/height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const from=(Math.floor(y*dy/65536)*source.width+Math.floor(x*dx/65536))*4,to=(y*width+x)*4;
      output.data.set(source.data.subarray(from,from+4),to);
      if(!source.hasAlpha)output.data[to+3]=255;
    }
  }
  return output;
}

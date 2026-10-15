import {combineRaster} from './image-combine.mjs';

// Match native draw_combine_image: capture the backdrop, combine RGB with the
// foreground, then draw with the foreground's alpha. CSS blend modes differ
// from MSE's integer channel formulas and do not cover all of its modes.
export function drawCombinedLayer(target,layer,mode,createCanvas){
  const {width,height}=layer;
  const foreground=layer.getContext('2d').getImageData(0,0,width,height);
  const backdrop=target.getImageData(0,0,width,height);
  const result=combineRaster({width,height,data:new Uint8ClampedArray(backdrop.data),hasAlpha:false},
    {width,height,data:foreground.data,hasAlpha:true},mode);
  const bitmap=createCanvas(width,height),dc=bitmap.getContext('2d'),pixels=dc.createImageData(width,height);
  pixels.data.set(result.data);dc.putImageData(pixels,0,0);
  target.drawImage(bitmap,0,0);
}

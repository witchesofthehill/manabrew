import { allocateRaster } from './image-sampling.mjs';
import { MseError } from './document.mjs';

// Native make_stroke_image uses repeated dilation and an in-place cross blur.
// Canvas shadowBlur is a different filter and cannot reproduce these pixels.
export function strokeRaster(source, color, radius = 0, blur = 0, maxPixels = 16777216) {
  if (!Number.isFinite(radius) || !Number.isFinite(blur)) throw new MseError('image-stroke', 'Stroke radii must be finite');
  radius = Math.max(0, Math.min(100, Math.trunc(radius)));
  blur = Math.max(0, Math.min(100, Math.trunc(blur)));
  const margin = radius + blur, width = source.width + 2 * margin, height = source.height + 2 * margin;
  const out = allocateRaster(width, height, true, maxPixels);
  const alpha = new Uint8Array(width * height);
  const [r,g,b,a] = color;
  for (let y=0;y<source.height;y++) for (let x=0;x<source.width;x++) {
    alpha[(y+margin)*width+x+margin] = Math.trunc((source.hasAlpha ? source.data[(y*source.width+x)*4+3] : 255) * a / 255);
  }
  for (let pass=0;pass<radius;pass++) {
    const copy = alpha.slice();
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const i=y*width+x;
      let cross=copy[i], diagonal=cross;
      for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
        if (x+dx<0 || x+dx>=width || y+dy<0 || y+dy>=height) continue;
        const value=copy[i+dy*width+dx];
        if (dx && dy) diagonal=Math.max(diagonal,value);
        else cross=Math.max(cross,value);
      }
      alpha[i]=diagonal>cross ? Math.trunc((3*diagonal+2*cross)/5) : cross;
    }
  }
  for (let pass=0;pass<blur;pass++) for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const i=y*width+x, center=alpha[i];
    alpha[i]=Math.trunc((3*center+(x ? alpha[i-1] : center)+(y ? alpha[i-width] : center)
      +(x<width-1 ? alpha[i+1] : center)+(y<height-1 ? alpha[i+width] : center))/7);
  }
  for (let i=0;i<alpha.length;i++) out.data.set([r,g,b,alpha[i]],i*4);
  return out;
}

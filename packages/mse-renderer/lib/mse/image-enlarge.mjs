import { allocateRaster } from './image-sampling.mjs';
import { MseError } from './document.mjs';

export function enlargeRaster(source, border, maxPixels = 16777216) {
  if (!Number.isFinite(border) || border < 0) throw new MseError('image-enlarge', 'Image border must be finite and nonnegative');
  const dx = Math.trunc(source.width * border), dy = Math.trunc(source.height * border);
  const out = allocateRaster(source.width + 2 * dx, source.height + 2 * dy, true, maxPixels);
  for (let y=0;y<source.height;y++) for (let x=0;x<source.width;x++) {
    const from=(y*source.width+x)*4, to=((y+dy)*out.width+x+dx)*4;
    out.data.set(source.data.subarray(from,from+3),to);
    // Native initializes all alpha to zero and only copies a source alpha
    // channel when present. Preserve this behavior for opaque input images.
    if (source.hasAlpha) out.data[to+3]=source.data[from+3];
  }
  return out;
}

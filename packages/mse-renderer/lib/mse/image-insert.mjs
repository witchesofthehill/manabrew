import { allocateRaster } from './image-sampling.mjs';

const f = Math.fround;
// wxImage::Paste(COMPOSE) uses single-precision arithmetic and rounds each
// output byte. Preserve its behavior at half-byte boundaries.
export function composePixel(target, ti, source, si, hasAlpha) {
  if (!hasAlpha) {
    target.set(source.subarray(si, si + 3), ti);
    target[ti + 3] = 255;
    return;
  }
  const alpha = f(source[si + 3] / 255);
  const left = f(f(target[ti + 3] / 255) * f(1 - alpha));
  const result = f(alpha + left);
  target[ti + 3] = Math.trunc(f(f(result * 255) + 0.5));
  for (let c = 0; c < 3; c++) target[ti + c] = result <= 0 ? 0 :
    Math.trunc(f(f(f(f(source[si + c] * alpha) + f(target[ti + c] * left)) / result) + 0.5));
}

export function insertRaster(base, inserted, { offsetX, offsetY, widen, background }, maxPixels) {
  const bx = widen ? Math.max(0, -offsetX) : 0, by = widen ? Math.max(0, -offsetY) : 0;
  const ix = offsetX + bx, iy = offsetY + by;
  const width = widen ? Math.max(bx + base.width, ix + inserted.width) : base.width;
  const height = widen ? Math.max(by + base.height, iy + inserted.height) : base.height;
  const output = allocateRaster(width, height, true, maxPixels);
  for (let i = 0; i < output.data.length; i += 4) output.data.set(background, i);
  const paste = (source, x, y) => {
    for (let sy = Math.max(0, -y); sy < Math.min(source.height, height - y); sy++) {
      for (let sx = Math.max(0, -x); sx < Math.min(source.width, width - x); sx++) {
        composePixel(output.data, ((sy + y) * width + sx + x) * 4, source.data, (sy * source.width + sx) * 4, source.hasAlpha);
      }
    }
  };
  paste(base, bx, by);
  paste(inserted, ix, iy);
  return output;
}

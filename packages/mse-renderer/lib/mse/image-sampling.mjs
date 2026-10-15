import { MseError } from './document.mjs';

export function allocateRaster(width, height, hasAlpha, maxPixels) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new MseError('image-size', `Invalid image dimensions ${width}x${height}`);
  if (width * height > maxPixels) throw new MseError('image-budget', 'Image exceeds pixel budget');
  const data = new Uint8ClampedArray(width * height * 4);
  if (!hasAlpha) for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data, hasAlpha };
}

function pass(source, length, horizontal, maxPixels) {
  const inputLength = horizontal ? source.width : source.height;
  const lines = horizontal ? source.height : source.width;
  const out = allocateRaster(horizontal ? length : lines, horizontal ? lines : length, source.hasAlpha, maxPixels);
  const scale = 16384;
  const weight = Math.floor(length * scale / inputLength), remainder = length * scale % inputLength;
  for (let line = 0; line < lines; line++) {
    let sample = 0, remaining = weight + remainder;
    for (let pixel = 0; pixel < length; pixel++) {
      let needed = scale, red = 0, green = 0, blue = 0, alpha = 0;
      while (needed > 0) {
        const take = Math.min(needed, remaining);
        const offset = (horizontal ? line * source.width + sample : sample * source.width + line) * 4;
        const a = source.hasAlpha ? source.data[offset + 3] : 255;
        const multiplier = take * (source.hasAlpha ? a : 1);
        red += source.data[offset] * multiplier;
        green += source.data[offset + 1] * multiplier;
        blue += source.data[offset + 2] * multiplier;
        alpha += take * a;
        needed -= take; remaining -= take;
        if (!remaining) { sample++; remaining = weight; }
      }
      const target = (horizontal ? line * out.width + pixel : pixel * out.width + line) * 4;
      const denominator = source.hasAlpha ? alpha : scale;
      if (denominator) {
        out.data[target] = Math.trunc(red / denominator);
        out.data[target + 1] = Math.trunc(green / denominator);
        out.data[target + 2] = Math.trunc(blue / denominator);
      }
      out.data[target + 3] = Math.trunc(alpha / scale);
    }
  }
  return out;
}

export function resizeRaster(source, width, height, maxPixels = 16777216) {
  width = Math.max(1, Math.trunc(width)); height = Math.max(1, Math.trunc(height));
  if (source.width === width && source.height === height) return source;
  // Native MSE uses two fixed-point area passes, including for enlargement.
  // Premultiplication prevents transparent pixels from tinting opaque pixels.
  const horizontal = pass(source, width, true, maxPixels);
  return source.height === height ? horizontal : pass(horizontal, height, false, maxPixels);
}

export function cropRaster(source, width, height, offsetX, offsetY, background = [0, 0, 0, 0], maxPixels = 16777216) {
  offsetX = Math.trunc(offsetX); offsetY = Math.trunc(offsetY);
  const covered = offsetX >= 0 && offsetY >= 0 && offsetX + width <= source.width && offsetY + height <= source.height;
  const output = allocateRaster(width, height, source.hasAlpha || (!covered && background[3] !== 255), maxPixels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = x + offsetX, sy = y + offsetY, target = (y * width + x) * 4;
    if (sx >= 0 && sy >= 0 && sx < source.width && sy < source.height) {
      const from = (sy * source.width + sx) * 4;
      output.data.set(source.data.subarray(from, from + 4), target);
      if (!source.hasAlpha) output.data[target + 3] = 255;
    } else output.data.set(background, target);
  }
  return output;
}

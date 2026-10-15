import { visibilityRaster } from './image-visibility.mjs';
import { bleedRaster } from './image-bleed.mjs';
import { insertRaster, composePixel } from './image-insert.mjs';
import { nineSliceRaster } from './image-nine-slice.mjs';
import { strokeRaster } from './image-stroke.mjs';
import { dropShadowRaster } from './image-shadow.mjs';
import { enlargeRaster } from './image-enlarge.mjs';
import { combineRaster } from './image-combine.mjs';
import { MseError } from './document.mjs';
import { MseImage } from './script-values.mjs';
import { resizeRaster, cropRaster } from './image-sampling.mjs';

const byte = value => Math.max(0, Math.min(255, Math.trunc(value)));
const nativeRound = value => Math.trunc(value + (value > 0 ? 0.4999995 : -0.4999995));
const gray = rgb => Math.trunc((6969 * rgb[0] + 23434 * rgb[1] + 2365 * rgb[2]) / 32768);
const white = [255, 255, 255], black = [0, 0, 0];
function validate(raster) {
  if (!raster || !Number.isSafeInteger(raster.width) || !Number.isSafeInteger(raster.height) || raster.width < 1 || raster.height < 1 || raster.data?.length !== raster.width * raster.height * 4) throw new MseError('image-data', 'Expected a positive-sized RGBA raster');
  return raster;
}
function sameSize(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new MseError('image-size', `Cannot blend ${a.width}x${a.height} with ${b.width}x${b.height}`);
}

// Graph evaluation is asynchronous only at the asset boundary. Filters operate
// on copies, so differently colored cards can safely share decoded asset data.
export class MseImageRenderer {
  constructor({ loadAsset, loadArtwork, renderSymbol, maxPixels = 16777216 } = {}) { this.loadAsset = loadAsset; this.loadArtwork = loadArtwork; this.renderSymbol = renderSymbol; this.maxPixels = maxPixels; this.prefetched = new WeakMap(); }
  // Evaluation awaits each child before reaching the next, so a cold frame
  // would download its assets one round trip at a time. Start every leaf of
  // the graph up front. The asset node's own evaluation consumes the request,
  // so each evaluated node still loads once and reports its own failure.
  prefetch(image) {
    if (!this.loadAsset || !(image instanceof MseImage)) return;
    const pending = [image], seen = new Set();
    while (pending.length) {
      const node = pending.pop();
      if (seen.has(node)) continue;
      seen.add(node);
      if (node.operation === 'asset') {
        if (this.prefetched.has(node)) continue;
        const request = Promise.resolve().then(() => this.loadAsset(node.parameters.path));
        request.catch(() => {});
        this.prefetched.set(node, request);
        continue;
      }
      for (const value of Object.values(node.parameters)) if (value instanceof MseImage) pending.push(value);
    }
  }
  render(image, options) {
    this.prefetch(image);
    return this.evaluate(image, options);
  }
  async evaluate(image, { width = 0, height = 0 } = {}) {
    if (!(image instanceof MseImage)) throw new MseError('image-value', 'Expected an MSE image');
    const p = image.parameters;
    if (image.operation === 'symbol') {
      if (!this.renderSymbol) throw new MseError('symbol-renderer', 'A vector symbol rasterizer is required');
      const raster = validate(await this.renderSymbol(p, { width, height, maxPixels: this.maxPixels }));
      if (raster.width * raster.height > this.maxPixels) throw new MseError('image-budget', 'Image exceeds pixel budget');
      return { ...raster, data: new Uint8ClampedArray(raster.data) };
    }
    if (image.operation === 'blank') {
      width = Math.max(1, width); height = Math.max(1, height);
      if (!Number.isSafeInteger(width * height) || width * height > this.maxPixels) throw new MseError('image-budget', 'Image exceeds pixel budget');
      return validate({ width, height, data: new Uint8ClampedArray(width * height * 4), hasAlpha: true });
    }
    if (image.operation === 'artwork') {
      if (!this.loadArtwork) throw new MseError('card-art', 'A card artwork provider is required');
      const raster = validate(await this.loadArtwork(p.source));
      if (raster.width * raster.height > this.maxPixels) throw new MseError('image-budget', 'Image exceeds pixel budget');
      return { ...raster, data: new Uint8ClampedArray(raster.data) };
    }
    if (image.operation === 'asset') {
      if (!this.loadAsset) throw new MseError('image-loader', 'A decoded image asset provider is required');
      const prefetched = this.prefetched.get(image);
      this.prefetched.delete(image);
      const raster = validate(await (prefetched ?? this.loadAsset(p.path)));
      if (raster.width * raster.height > this.maxPixels) throw new MseError('image-budget', 'Image exceeds pixel budget');
      return { ...raster, data: new Uint8ClampedArray(raster.data) };
    }
    if (image.operation === 'enlarge') {
      if (!Number.isFinite(p.border) || p.border < 0) throw new MseError('image-enlarge', 'Image border must be finite and nonnegative');
      const factor = p.border < 0.5 ? 1 - 2 * p.border : 0;
      const source = await this.evaluate(p.image, { width: Math.trunc(width * factor), height: Math.trunc(height * factor) });
      return enlargeRaster(source, p.border, this.maxPixels);
    }
    const render = child => this.evaluate(child, { width, height });
    const first = p.image || p.light || p.image1;
    if (!first) throw new MseError('image-operation', `Unsupported image operation ${image.operation}`);
    const raster = await render(first), data = raster.data;
    if (image.operation === 'set-combine') return raster;
    if (image.operation === 'bleed') return bleedRaster(raster,p,this.maxPixels);
    if (image.operation === 'visibility-mask') return visibilityRaster(raster,p.threshold,p.radius,this.maxPixels);
    if (image.operation === 'nine-slice') return nineSliceRaster(raster,p,this.maxPixels);
    if (image.operation === 'drop-shadow') return dropShadowRaster(raster, p);
    if (image.operation === 'stroke') {
      const output = strokeRaster(raster, p.color, p.radius, p.blur, this.maxPixels);
      if (p.includeImage) {
        // Native placement uses the original requested radii, even though the
        // effect's allocation clamps each radius to 0..100.
        const offset = p.radius + p.blur;
        for (let y = Math.max(0, -offset); y < Math.min(raster.height, output.height - offset); y++) {
          for (let x = Math.max(0, -offset); x < Math.min(raster.width, output.width - offset); x++) {
            composePixel(output.data, ((y + offset) * output.width + x + offset) * 4,
              data, (y * raster.width + x) * 4, raster.hasAlpha);
          }
        }
      }
      return output;
    }
    if (image.operation === 'insert') return insertRaster(raster, await render(p.inserted), p, this.maxPixels);
    if (image.operation === 'combine') return combineRaster(raster, await render(p.image2), p.mode);
    if (image.operation === 'resize') return resizeRaster(raster, p.width, p.height, this.maxPixels);
    if (image.operation === 'crop') return cropRaster(raster, p.width, p.height, p.offsetX, p.offsetY, p.background, this.maxPixels);
    if (image.operation === 'recolor') {
      const dark = p.color && gray(p.color) < 100;
      const colors = p.color ? [p.color, dark ? black : white, dark ? white : black, white] : [p.red, p.green, p.blue, p.white];
      for (let i = 0; i < data.length; i += 4) {
        const low = Math.min(data[i], data[i + 1], data[i + 2]);
        const weights = [data[i] - low, data[i + 1] - low, data[i + 2] - low, low];
        const total = Math.max(255, weights.reduce((a, b) => a + b, 0));
        for (let channel = 0; channel < 3; channel++) data[i + channel] = byte(weights.reduce((sum, weight, index) => sum + weight * colors[index][channel], 0) / total);
      }
    } else if (image.operation === 'brighten') {
      if (!Number.isFinite(p.amount)) throw new MseError('image-brightness','Brightness amount must be finite');
      const amount=Math.max(-1,Math.min(1,p.amount));
      if (Math.abs(amount)>=1e-8) for(let i=0;i<data.length;i+=4) for(let c=0;c<3;c++)
        data[i+c]=Math.trunc(amount>0?255*amount+data[i+c]*(1-amount):data[i+c]*(1+amount));
    } else if (image.operation === 'saturate') {
      // gfx/image_effects.cpp uses fixed-point integer arithmetic, including
      // truncation toward zero and byte wrapping in the desaturation branch.
      const factor = Math.trunc(256 * p.amount);
      if (!Number.isFinite(factor) || Math.abs(factor) * 765 + 768 * 255 > 2147483647)
        throw new MseError('image-saturation', 'Saturation amount exceeds native integer arithmetic range');
      if (factor) for (let i = 0; i < data.length; i += 4) {
        const channels = [data[i], data[i + 1], data[i + 2]], sum = channels.reduce((a,b)=>a+b,0);
        for (let c = 0; c < 3; c++) {
          if (factor === 256) data[i+c] = 3 * channels[c] > sum ? 255 : 0;
          else if (factor > 0) data[i+c] = byte((768 * channels[c] - factor * sum) / (768 - 3 * factor));
          else data[i+c] = ((Math.trunc(((768 + 3 * factor) * channels[c] - factor * sum) / 768) % 256) + 256) % 256;
        }
      }
    } else if (['fill', 'invert', 'alpha'].includes(image.operation)) {
      for (let i = 0; i < data.length; i += 4) {
        if (image.operation === 'alpha') data[i + 3] = byte(data[i + 3] * p.alpha);
        else for (let c = 0; c < 3; c++) data[i + c] = image.operation === 'fill' ? p.color[c] : 255 - data[i + c];
      }
      if (image.operation === 'alpha') raster.hasAlpha = true;
    } else if (image.operation.startsWith('flip-')) {
      const original = data.slice();
      for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
        const sx = image.operation === 'flip-horizontal' ? raster.width - x - 1 : x;
        const sy = image.operation === 'flip-vertical' ? raster.height - y - 1 : y;
        data.set(original.subarray((sy * raster.width + sx) * 4, (sy * raster.width + sx) * 4 + 4), (y * raster.width + x) * 4);
      }
    } else if (image.operation === 'mask') {
      const mask = resizeRaster(await render(p.mask), raster.width, raster.height, this.maxPixels);
      for (let i = 0; i < data.length; i += 4) data[i + 3] = byte(data[i + 3] * mask.data[i] / 255);
      raster.hasAlpha = true;
    } else if (image.operation === 'masked-blend' || image.operation === 'linear-blend') {
      const other = await render(p.dark || p.image2); sameSize(raster, other);
      const mask = p.mask ? await render(p.mask) : null;
      if (mask) sameSize(raster, mask);
      let xm, ym, d;
      if (!mask) {
        if (p.x1 === p.x2 && p.y1 === p.y2) throw new MseError('image-blend', 'Coordinates for blending overlap');
        const a = 65536 / ((raster.width * (p.x1 - p.x2)) ** 2 + (raster.height * (p.y1 - p.y2)) ** 2);
        xm = nativeRound((p.x2 - p.x1) * raster.width * a); ym = nativeRound((p.y2 - p.y1) * raster.height * a);
        d = nativeRound(-(p.x1 * raster.width * xm + p.y1 * raster.height * ym));
      }
      for (let i = 0; i < data.length; i += 4) {
        const pixel = i / 4, fraction = mask ? 0 : Math.max(0, Math.min(65536, (pixel % raster.width) * xm + Math.floor(pixel / raster.width) * ym + d));
        for (let c = 0; c < 4; c++) {
          if (c === 3 && (!raster.hasAlpha || !other.hasAlpha)) continue;
          if (mask) { const amount = mask.data[i + (c === 3 ? 0 : c)]; data[i + c] = byte((data[i + c] * amount + other.data[i + c] * (255 - amount)) / 255); }
          else data[i + c] += Math.trunc(fraction * (other.data[i + c] - data[i + c]) / 65536);
        }
      }
    } else throw new MseError('image-operation', `Unsupported image operation ${image.operation}`);
    return raster;
  }
}

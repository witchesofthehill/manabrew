import { decodePng } from './png-decoder.mjs';
import { MseError } from './document.mjs';

export function createMseImageLoader(store, { fetcher = globalThis.fetch, maxPixels = 16777216, decodeBitmap = globalThis.createImageBitmap,
  createCanvas = (w,h) => new OffscreenCanvas(w,h) } = {}) {
  const cache = new Map();
  return async path => {
    if (!cache.has(path.key)) cache.set(path.key, (async () => {
      const response = await fetcher(store.assetUrl(path));
      if (!response.ok) throw new MseError('image-fetch', `Could not load ${path.key}: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes[0] === 137 && bytes[1] === 80) return decodePng(bytes, { maxPixels });
      if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new MseError('image-format', `Image format is not yet supported for ${path.key}`);
      if (!decodeBitmap) throw new MseError('image-decoder', 'Browser JPEG decoder is required');
      const bitmap = await decodeBitmap(new Blob([bytes], { type: 'image/jpeg' }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      try {
        const { width, height } = bitmap;
        if (width * height > maxPixels) throw new MseError('image-budget', 'Image exceeds pixel budget');
        const canvas = createCanvas(width,height), ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap,0,0);
        return { width, height, data: ctx.getImageData(0,0,width,height).data, hasAlpha: false };
      } finally { bitmap.close(); }
    })().catch(error => { cache.delete(path.key); throw error; }));
    return cache.get(path.key);
  };
}

import { MseError } from './document.mjs';
import { allocateRaster, resizeRaster } from './image-sampling.mjs';
import { alignmentOffset } from './alignment.mjs';

// This prepares image geometry and unwrapped advances. Text overlays, shadows,
// strokes and final line placement are handled by the drawing/layout consumer.
export async function measureSymbolRun(run, renderer, { scale = 1 } = {}) {
  const size = run.settings.size * scale;
  if (!Number.isFinite(size) || !Number.isFinite(scale) || scale <= 0) throw new MseError('symbol-scale', 'Symbol scale must be finite and positive');
  const glyphs = [], characters = [], images = new Map();
  let width = 0, height = 0;
  if (!run.font) return { settings: run.settings, fontSize: size, width, height, glyphs, characters, minScale: Math.min(run.settings.size, run.settings.scale_down_to) / Math.max(0.01, run.settings.size), scaleStep: 1 / Math.max(run.settings.size * 4, 1) };
  const spacingX = run.font.horizontalSpace * size / 15;
  const spacingY = run.font.verticalSpace * size / 15;
  for (const match of run.symbols) {
    const symbol = match.symbol;
    if (!symbol.image) throw new MseError('symbol-image', `No image specified for symbol ${symbol.code} in ${run.font.name}`);
    if (!Number.isFinite(symbol.imageSize) || symbol.imageSize <= 0) throw new MseError('symbol-image-size', `Invalid image font size for ${symbol.code}`);
    let image = images.get(symbol);
    if (!image) {
      const original = await renderer.render(symbol.image);
      const imageWidth = original.width * size / symbol.imageSize;
      const imageHeight = original.height * size / symbol.imageSize;
      const pixelWidth = Math.trunc(imageWidth), pixelHeight = Math.trunc(imageHeight);
      const bitmap = pixelWidth <= 0 || pixelHeight <= 0
        ? allocateRaster(1, 1, true, renderer.maxPixels)
        : resizeRaster(original, pixelWidth, pixelHeight, renderer.maxPixels);
      image = { bitmap, width: imageWidth + spacingX, height: imageHeight + spacingY };
      images.set(symbol, image);
    }
    const placement = alignmentOffset(run.settings.alignment, image.width, image.height, image.bitmap.width, image.bitmap.height);
    glyphs.push({ ...match, bitmap: image.bitmap, width: image.width, height: image.height, x: width + placement.x, y: placement.y });
    const count = [...match.text].length;
    for (let i = 0; i < count; i++) characters.push({ width: image.width / count, height: image.height, break: i === count - 1 ? 'maybe' : 'no' });
    width += image.width;
    height = Math.max(height, image.height);
  }
  return { settings: run.settings, fontSize: size, width, height, glyphs, characters, minScale: Math.min(run.settings.size, run.settings.scale_down_to) / Math.max(0.01, run.settings.size), scaleStep: 1 / Math.max(run.settings.size * 4, 1) };
}

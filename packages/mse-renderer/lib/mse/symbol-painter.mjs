import { prepareFontDrawing } from './font-painter.mjs';
import { strokeRaster } from './image-stroke.mjs';
import { MseError } from './document.mjs';
import { alignmentOffset } from './alignment.mjs';

export const cssColor = value => { const [r,g,b,a] = value?.channels || [0,0,0,255]; return `rgba(${r},${g},${b},${a/255})`; };

function bitmapCanvas(bitmap) {
  const canvas = globalThis.OffscreenCanvas ? new OffscreenCanvas(bitmap.width, bitmap.height) : globalThis.document?.createElement('canvas');
  if (!canvas) throw new MseError('text-drawing', 'A bitmap canvas provider is required');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(bitmap.width, bitmap.height);
  pixels.data.set(bitmap.data); ctx.putImageData(pixels, 0, 0);
  return canvas;
}

// Native SymbolFont::draw fits overlay text inside the bitmap, not its advance
// rectangle. The quarter-point decrement matches native high-quality drawing.
export async function prepareSymbolDrawing(measured, fonts, { createBitmap = bitmapCanvas, fontSizeStep = 0.25, createCanvas } = {}) {
  if (!Number.isFinite(fontSizeStep) || fontSizeStep <= 0) throw new MseError('text-drawing', 'Font size step must be positive');
  const settings = measured.settings;
  const active = (value) => Math.abs(value || 0) > 1e-8;
  const stroke = (active(settings.stroke_radius) || active(settings.stroke_blur)) && settings.stroke_color?.channels[3];
  const shadow = !stroke && (active(settings.shadow_blur) || active(settings.shadow_displacement_x) || active(settings.shadow_displacement_y)) && settings.shadow_color?.channels[3];
  const effectScale = measured.fontSize / 15;
  // C++ lround rounds halfway away from zero.
  const round = v => Math.sign(v) * Math.floor(Math.abs(v) + 0.5);
  const effects = new Map();
  const bitmaps = new Map(), glyphs = [];
  let character = 0;
  for (const glyph of measured.glyphs) {
    let bitmap = bitmaps.get(glyph.bitmap);
    if (!bitmap) { bitmap = await createBitmap(glyph.bitmap); bitmaps.set(glyph.bitmap, bitmap); }
    let effect = effects.get(glyph.bitmap);
    if (!effect && (stroke || shadow)) {
      const raster = strokeRaster(glyph.bitmap, (stroke ? settings.stroke_color : settings.shadow_color).channels,
        stroke ? round((settings.stroke_radius || 0) * effectScale) : 0,
        round((stroke ? settings.stroke_blur || 0 : settings.shadow_blur || 0) * effectScale));
      effect = { bitmap: await createBitmap(raster),
        x: -(raster.width - glyph.bitmap.width) / 2 + (shadow ? (settings.shadow_displacement_x || 0) * effectScale : 0),
        y: -(raster.height - glyph.bitmap.height) / 2 + (shadow ? (settings.shadow_displacement_y || 0) * effectScale : 0) };
      effects.set(glyph.bitmap, effect);
    }
    let overlay = null;
    const font = glyph.symbol.font;
    if (glyph.drawText && font && font.size > 0) {
      // SymbolFont::draw passes the symbol's font size as the extra effect
      // scale, independently of the shrink factor used to fit overlay text.
      const provider = await prepareFontDrawing(font,fonts,{createCanvas,effectScaleMultiplier:measured.fontSize});
      const margins = glyph.symbol.margins, size = measured.fontSize;
      const left = size * margins.left, top = size * margins.top;
      const width = glyph.bitmap.width - size * (margins.left + margins.right);
      const height = glyph.bitmap.height - size * (margins.top + margins.bottom);
      for (let textSize = size * font.size; textSize > 0 && width > 0 && height > 0; textSize -= fontSizeStep) {
        const scale = textSize / font.size;
        const extent = provider.measure(glyph.drawText, font, scale);
        if (extent.height > height) continue;
        const stretch = extent.width <= width ? 1 : width / extent.width;
        if (extent.width > width && stretch < (font.max_stretch ?? 1)) continue;
        const offset = alignmentOffset(glyph.symbol.alignment, width, height, extent.width * stretch, extent.height);
        overlay = { provider, scale, stretch, x: left + offset.x, y: top + offset.y, color: cssColor(font.color) };
        break;
      }
    }
    const count = [...glyph.text].length;
    glyphs.push({ glyph, bitmap, effect, overlay, start: character, end: character + count });
    character += count;
  }
  return (ctx, line, characterStart) => {
    const placed = [];
    for (const item of glyphs) {
      const { glyph, start, end } = item;
      const a = characterStart + start, b = characterStart + end;
      if (a < line.start || b > line.end) continue;
      const width = line.positions[b - line.start] - line.positions[a - line.start];
      const offset = alignmentOffset(measured.settings.alignment, width, line.height, glyph.bitmap.width, glyph.bitmap.height);
      const x = line.positions[a - line.start] + offset.x, y = line.top + offset.y;
      placed.push({ ...item, x, y });
    }
    // Native paints every effect first so adjacent symbols cover each other's
    // shadows rather than being painted under a later glyph's shadow.
    for (const { effect, x, y } of placed) if (effect) ctx.drawImage(effect.bitmap, x + effect.x, y + effect.y);
    for (const { glyph, bitmap, overlay, x, y } of placed) {
      ctx.drawImage(bitmap, x, y);
      if (overlay) {
        ctx.save();
        try {
          ctx.translate(x + overlay.x, y + overlay.y); ctx.scale(overlay.stretch, 1);
          ctx.fillStyle = overlay.color;
          overlay.provider.draw(ctx, glyph.drawText, 0, 0, overlay.scale);
        } finally { ctx.restore(); }
      }
    }
  };
}

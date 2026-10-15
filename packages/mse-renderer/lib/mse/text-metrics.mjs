import { MseError } from './document.mjs';

// FontTextElement::getCharInfo measures prefixes so kerning belongs to the
// preceding prefix rather than being lost by measuring individual characters.
export function measureTextRun(content, font, metrics, { scale = 1, breakStyle = 'hard', soft = false } = {}) {
  const characters = [];
  let prefix = '', previous = 0, width = 0, height = 0;
  for (const char of content) {
    if (char === '\n') {
      const h = metrics.lineHeight(font, scale);
      if (!Number.isFinite(h) || h < 0) throw new MseError('text-metrics', 'Invalid font line height');
      characters.push({ width: 0, height: h, break: breakStyle, soft, bullet: false });
      height = Math.max(height, h);
      width = Math.max(width, previous);
      prefix = ''; previous = 0;
    } else {
      prefix += char;
      const measured = metrics.measure(prefix, font, scale);
      if (!Number.isFinite(measured.width) || !Number.isFinite(measured.height) || measured.height < 0) throw new MseError('text-metrics', 'Invalid text measurement');
      characters.push({ width: measured.width - previous, height: measured.height, break: char === ' ' ? 'space' : 'maybe', soft, bullet: char === '•' });
      previous = measured.width;
      height = Math.max(height, measured.height);
    }
  }
  return { characters, width: Math.max(width, previous), height, minScale: Math.min(font.size, font.scale_down_to) / Math.max(0.01, font.size), scaleStep: 1 / Math.max(font.size * 4, 1) };
}

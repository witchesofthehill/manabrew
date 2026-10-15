import { alignmentOffset } from './alignment.mjs';

// TextViewer::Line::alignHorizontal. Stretching selects a drawing transform in
// another stage; native alignment itself leaves those positions unchanged.
export function alignTextLine(line, chars, { alignment, multiLine = true, x = 0, width, maskLeft = x, maskRight = x + width } = {}) {
  const result = { ...line, positions: [...line.positions], justifying: false };
  const margin = line.bullet ? line.marginLeftBeforeBullet || 0 : line.marginLeftAfterBullet || 0;
  const rightMargin = line.marginRight || 0;
  const contentWidth = line.width - margin, targetWidth = width - margin - rightMargin;
  alignment = line.alignment ?? alignment;
  const fill = (!(alignment & 4096) || contentWidth > targetWidth)
    && (!(alignment & 8192) || line.break === 'wrap' || line.break === 'soft' || !multiLine);
  const delta = targetWidth - contentWidth;
  if ((alignment & 64) && fill) {
    result.justifying = true;
    const count = Math.max(1, line.endOrSoft - line.start);
    result.positions = result.positions.map((p, i) => p + x + delta * i / count);
  } else if ((alignment & 32) && fill) {
    result.justifying = true;
    let count = 0;
    for (let k = line.start + 1; k < line.endOrSoft - 1; k++) if (chars[k].break === 'space') count++;
    count = Math.max(1, count);
    let spaces = 0, j = line.start;
    result.positions = result.positions.map(p => {
      const value = p + x + delta * spaces / count;
      if (j < line.endOrSoft && chars[j++].break === 'space') spaces++;
      return value;
    });
  } else if (!((alignment & 16) && fill)) {
    let shift = x + alignmentOffset(alignment, targetWidth, 0, contentWidth, 0).x;
    if (alignment & 6) {
      const min = (line.maskLeft ?? maskLeft) + margin;
      const max = (line.maskRight ?? maskRight) - rightMargin - contentWidth;
      if (max >= min) shift = Math.max(min, Math.min(max, margin + shift)) - line.positions[0];
    }
    result.positions = result.positions.map(p => p + shift);
  }
  result.width = result.positions[line.endOrSoft - line.start] - result.positions[0];
  return result;
}

export function textContentHeight(lines) {
  if (!lines.length) return 0;
  let bottom = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    bottom = lines[i].top + lines[i].height;
    if (lines[i].height) break;
  }
  return bottom - lines[0].top;
}

export function alignTextParagraph(input, chars, {
  height, y = 0, alignment = 257,
  lineHeightSoft = 1, lineHeightHard = 1, lineHeightLine = 1,
  lineHeightSoftMax = 0, lineHeightHardMax = 0, lineHeightLineMax = 0,
  ...horizontal
} = {}) {
  if (!input.length) return [];
  let lines = input.map(line => ({ ...line, positions: [...line.positions] }));
  let contentHeight = textContentHeight(lines);
  const soft = Math.max(0, lineHeightSoftMax - lineHeightSoft);
  const hard = Math.max(0, lineHeightHardMax - lineHeightHard);
  const separator = Math.max(0, lineHeightLineMax - lineHeightLine);
  const stops = [0, ...[soft, hard, separator].sort((a, b) => a - b)];
  for (let i = 1; i < 4 && contentHeight < height; i++) {
    const stop = stops[i] - stops[i - 1];
    if (stop <= 0) continue;
    // Native compares each capacity to the interval, not to its endpoint.
    const applies = line => ((line.break === 'soft' || line.break === 'wrap') && soft >= stop)
      || (line.break === 'hard' && hard >= stop) || (line.break === 'line' && separator >= stop);
    const sum = lines.reduce((total, line) => total + (applies(line) ? line.height : 0), 0);
    if (!sum) break;
    const increment = Math.min(stop, (height - contentHeight) / sum);
    let added = 0;
    for (const line of lines) {
      line.top += added;
      if (applies(line)) added += increment * line.height;
    }
    contentHeight += added;
  }
  if (alignment === 257) return lines;
  const delta = alignmentOffset(alignment, 0, height, 0, contentHeight).y + y - lines[0].top;
  return lines.map(line => alignTextLine({ ...line, top: line.top + delta }, chars, { ...horizontal, alignment }));
}

export function alignTextLines(lines, chars, { paragraphHeight = -1, ...options } = {}) {
  if (paragraphHeight <= 0) return alignTextParagraph(lines, chars, options);
  const output = [];
  let start = 0, paragraph = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].break === 'hard' || lines[i].break === 'line' || i + 1 === lines.length) {
      const y = options.alignment & (512 | 1024) ? (options.y || 0) + paragraph * paragraphHeight : lines[start].top;
      output.push(...alignTextParagraph(lines.slice(start, i + 1), chars, { ...options, y, height: paragraphHeight }));
      start = i + 1; paragraph++;
    }
  }
  return output;
}

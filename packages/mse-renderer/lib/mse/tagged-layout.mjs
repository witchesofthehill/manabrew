import { alignmentOffset } from './alignment.mjs';
import { measureTaggedText } from './tagged-text.mjs';
import { selectTextScaleAsync } from './text-scale.mjs';
import { wrapTextCharacters } from './text-wrap.mjs';
import { alignTextLines, textContentHeight } from './text-alignment.mjs';

export async function layoutTaggedText(parsed, fonts, symbols, renderer, options) {
  options={...options};
  const { width, height, paddingLeft = 0, paddingRight = 0, paddingTop = 0, paddingBottom = 0, previousScale = 1 } = options;
  const measured = new Map();
  const wrappingOptions={...options,emptyClause:parsed.clauses?.at(-1)};
  const atScale = async scale => {
    if (!measured.has(scale)) measured.set(scale, await measureTaggedText(parsed, fonts, symbols, renderer, { scale, alwaysSymbol: options.alwaysSymbol }));
    return measured.get(scale);
  };
  const initial = await atScale(previousScale);
  const result = await selectTextScaleAsync(async scale => {
    const measurement = await atScale(scale);
    return { ...wrapTextCharacters(measurement.characters, wrappingOptions), measurement };
  }, { minScale: initial.minScale, scaleStep: initial.scaleStep, previousScale, height, paddingBottom });
  let wrapped = result;
  let offset = 0;
  const seen = [];
  for (let iteration = 0; iteration < 6; iteration++) {
    if(options.refreshLayoutStyle){
      const updated=options.refreshLayoutStyle(wrapped.lines);
      Object.assign(options,updated);Object.assign(wrappingOptions,updated);
    }
    if (!(options.paragraphHeight <= 0 || options.paragraphHeight === undefined) || !(options.alignment & (512 | 1024))) break;
    const next = alignmentOffset(options.alignment, 0, height - paddingTop - paddingBottom, 0, textContentHeight(wrapped.lines)).y;
    if (Math.abs(next - offset) < 0.5 || seen.some(value => Math.abs(value - next) < 0.5)) break;
    seen.push(next); offset = next;
    wrapped = wrapTextCharacters(result.measurement.characters, { ...wrappingOptions, topOffset: offset });
  }
  const lines = alignTextLines(wrapped.lines, result.measurement.characters, {
    ...options, width: width - paddingLeft - paddingRight, height: height - paddingTop - paddingBottom,
    maskLeft: paddingLeft, maskRight: width - paddingRight,
    y: options.alignment & (512|1024)?paddingTop+(parsed.clauses?.[0]?.marginTop||0):wrapped.lines[0]?.top??paddingTop,
  });
  const contentWidth=Math.max(0,...lines.map(l=>l.width));
  // TextStyle::getStretch acts on the entire prepared field, including symbols.
  // Keep unscaled layout metrics available to template scripts.
  const factor=contentWidth>0?(width-paddingLeft-paddingRight)/contentWidth:1;
  const stretch=(options.alignment&16)&&(!(options.alignment&4096)||factor<1)?factor:1;
  return { ...result, lines, width:contentWidth, height:textContentHeight(lines), stretch };
}

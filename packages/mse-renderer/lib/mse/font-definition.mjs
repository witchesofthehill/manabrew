import { parseAlignment } from './alignment.mjs';
import { boolean, number, text } from './script-values.mjs';
import { color } from './color-values.mjs';

const defaults = {
  name: '', italic_name: '', size: 1, weight: '', style: '',
  underline: false, strikethrough: false, scale_down_to: 100000, max_stretch: 1,
  color: 'black', shadow_color: 'black', shadow_displacement_x: 0,
  shadow_displacement_y: 0, shadow_blur: 0, stroke_color: 'black',
  stroke_radius: 0, stroke_blur: 0, separator_color: 'rgba(0,0,0,128)',
};
const symbolDefaults = { name: '', size: 12, scale_down_to: 1, underline: false, strikethrough: false, alignment: 514, shadow_color: 'black', shadow_displacement_x: 0, shadow_displacement_y: 0, shadow_blur: 0, stroke_color: 'black', stroke_radius: 0, stroke_blur: 0 };
const fixed = new Set(['scale_down_to', 'max_stretch', 'separator_color']);
function convert(key, value) {
  if (key === 'alignment') return typeof value === 'number' ? value : parseAlignment(text(value));
  if (key.endsWith('color')) return color(value);
  if (typeof defaults[key] === 'number') return number(value);
  if (typeof defaults[key] === 'boolean') return boolean(value);
  return text(value);
}
export async function compileFontDefinition(record, loader, { symbol = false } = {}) {
  const programs = new Map(), values = {};
  for (const [key, fallback] of Object.entries(symbol ? symbolDefaults : defaults)) {
    const entry = record?.last(key);
    values[key] = convert(key, fixed.has(key) && entry ? entry.text() : fallback);
    if (entry && !fixed.has(key)) programs.set(key, await loader.compileScriptable(entry.text(), entry.location));
  }
  return { programs, values, symbol };
}
export function evaluateFontDefinition(definition, evaluate) {
  const font = { ...definition.values };
  for (const [key, program] of definition.programs) font[key] = convert(key, evaluate(program));
  if (!definition.symbol) {
    font.bold = font.weight === 'bold';
    font.italic = font.style === 'italic';
  }
  return font;
}

// Resolve the face selected by native FontRef::toWxFont. Markup can supply a
// different family; such a run must not switch back to the base italic face.
export function resolveFontFace(font, { bold = false, italic = false, fromTag = false, family } = {}) {
  let name = family || font.name;
  bold ||= font.bold;
  italic ||= font.italic;
  if(font.code)return {name:'Courier New',bold,italic:false};
  if (!fromTag && italic && font.italic_name) {
    name = font.italic_name;
    italic = false;
  } else if (name.endsWith(' Bold')) {
    name = name.slice(0, -5);
    bold = true;
  }
  return { name, bold, italic };
}

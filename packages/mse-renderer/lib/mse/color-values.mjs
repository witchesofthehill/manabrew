import { MseColor, MseKeywordParameter, force, conversion } from './script-values.mjs';
import { namedColors } from './named-colors.mjs';

// MSE's three overrides are case-sensitive; wx database lookup is not.
// Unknown names remain explicit conversion failures, never substituted black.
const names = {
  silver: [200, 200, 200], gold: [200, 180, 0], transparent: [0, 0, 0, 0],
};
export function color(value) {
  value = force(value);
  if (value instanceof MseKeywordParameter) value = value.value;
  if (value instanceof MseColor) return value;
  if (value === null) return new MseColor(0, 0, 0, 0);
  if (typeof value !== 'string') return conversion(value, 'color');
  // Native scanf accepts a complete channel prefix without requiring the
  // closing delimiter. In particular rgb(r,g,b,a) ignores its fourth value;
  // the Kamigawa showcase templates depend on that behavior.
  const byte=value=>Number(BigInt.asUintN(8,BigInt(value)));
  const rgb = /^rgb\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*,\s*([+-]?\d+)/.exec(value);
  if (rgb) return new MseColor(...rgb.slice(1).map(byte));
  const rgba = /^rgba\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*,\s*([+-]?\d+)/.exec(value);
  if (rgba) return new MseColor(...rgba.slice(1).map(byte));
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) {
    const hex = value.slice(1), width = hex.length <= 4 ? 1 : 2;
    const channels = [];
    for (let i = 0; i < hex.length; i += width) channels.push(parseInt(hex.slice(i, i + width), 16) * (width === 1 ? 17 : 1));
    return new MseColor(...channels);
  }
  const channels = Object.hasOwn(names,value)?names[value]
    :Object.hasOwn(namedColors,value.toLowerCase())?namedColors[value.toLowerCase()]:null;
  if (channels) return new MseColor(...channels);
  return conversion(value, 'color');
}

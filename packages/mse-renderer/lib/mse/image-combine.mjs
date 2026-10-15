import { MseError } from './document.mjs';

const div = (a, b) => Math.trunc(a / b);
const clamp = a => Math.max(0, Math.min(255, a));
const overlay = (a, b) => a < 128 ? (a * b) >> 7 : 255 - (((255 - a) * (255 - b)) >> 7);
const modes = new Map(Object.entries({
  normal: (a, b) => b,
  add: (a, b) => Math.min(255, a + b),
  subtract: (a, b) => Math.max(0, a - b),
  average: (a, b) => div(a + b, 2),
  stamp: (a, b) => clamp(a - 2 * b + 256),
  difference: (a, b) => Math.abs(a - b),
  negation: (a, b) => 255 - Math.abs(255 - a - b),
  multiply: (a, b) => div(a * b, 255),
  darken: Math.min,
  lighten: Math.max,
  'color dodge': (a, b) => b === 255 ? 255 : Math.min(255, div(a * 255, 255 - b)),
  'color burn': (a, b) => b === 0 ? 0 : Math.max(0, 255 - div((255 - a) * 255, b)),
  screen: (a, b) => 255 - div((255 - a) * (255 - b), 255),
  overlay,
  'hard light': (a, b) => overlay(b, a),
  // Native MSE currently defines soft light as the second channel unchanged.
  'soft light': (a, b) => b,
  reflect: (a, b) => b === 255 ? 255 : Math.min(255, div(a * a, 255 - b)),
  glow: (a, b) => a === 255 ? 255 : Math.min(255, div(b * b, 255 - a)),
  freeze: (a, b) => b === 0 ? 0 : Math.max(0, 255 - div((255 - a) * (255 - a), b)),
  heat: (a, b) => a === 0 ? 0 : Math.max(0, 255 - div((255 - b) * (255 - b), a)),
  and: (a, b) => a & b,
  or: (a, b) => a | b,
  xor: (a, b) => a ^ b,
  shadow: (a, b) => div(b * a * a, 255 * 255),
  'lightmap absolute': (a, b) => clamp(a + b - 128),
  'lightmap relative': (a, b) => b < 128 ? div(a * b, 128) : a + div((255 - a) * (b - 128), 128),
  'symmetric overlay': (a, b) => div(overlay(a, b) + overlay(b, a), 2),
  'brightness to alpha': (a, b) => div((255 - a) * a + a * b, 255),
  'darkness to alpha': (a, b) => div(255 * a + (255 - a) * b, 255),
}));
for (let threshold = 5; threshold <= 250; threshold += 5) {
  modes.set(`greater than ${threshold}`, (a, b) => a > threshold ? b : a);
  modes.set(`smaller than ${threshold}`, (a, b) => a < threshold ? b : a);
}
export const imageCombineModes = Object.freeze([...modes.keys()]);
export function combineChannel(mode) {
  const fn = modes.get(mode);
  if (!fn) throw new MseError('image-combine', `Unknown image combining mode ${mode}`);
  return fn;
}
export function combineRaster(a, b, mode) {
  const fn = combineChannel(mode);
  if (a.width !== b.width || a.height !== b.height) throw new MseError('image-size', `Cannot blend ${a.width}x${a.height} with ${b.width}x${b.height}`);
  if (mode === 'normal') return b;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) a.data[i + channel] = fn(a.data[i + channel], b.data[i + channel]);
    if (b.hasAlpha) a.data[i + 3] = b.data[i + 3];
  }
  a.hasAlpha ||= b.hasAlpha;
  return a;
}

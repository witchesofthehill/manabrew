import { MseScriptLoader } from './script-loader.mjs';
import { MseScope } from './script-runtime.mjs';
import { MseFunction, boolean, number, text, force } from './script-values.mjs';
import { imageBuiltins, mseImage } from './image-builtins.mjs';
import { compileMseRegex } from './regex.mjs';
import { compileFontDefinition, evaluateFontDefinition } from './font-definition.mjs';
import { parseAlignment } from './alignment.mjs';

const stores = new WeakMap();
export async function loadSymbolFont(store, name) {
  if (!name) return null;
  name = name.endsWith('.mse-symbol-font') ? name : name + '.mse-symbol-font';
  let cache = stores.get(store);
  if (!cache) stores.set(store, cache = new Map());
  if (!cache.has(name)) cache.set(name, compile(store, name).catch(error => { cache.delete(name); throw error; }));
  return cache.get(name);
}
async function compile(store, name) {
  const record = await store.expandRecord((await store.package(name)).document);
  const loader = new MseScriptLoader(store);
  const program = entry => entry ? loader.compileScriptable(entry.text(), entry.location) : null;
  const value = (record, key, fallback) => record.last(key) ? record.text(key) : fallback;
  const imageSize = number(value(record, 'image font size', 12));
  const symbols = [];
  for (const entry of record.all('symbol')) {
    const symbol = await store.expandRecord(entry.record());
    const code = symbol.text('code');
    symbols.push({
      code, regex: boolean(value(symbol, 'regex', false)) ? compileMseRegex(code) : null,
      drawText: number(value(symbol, 'draw text', -1), true),
      imageSize: number(value(symbol, 'image font size', (imageSize <= 0 ? 1 : imageSize))),
      image: await program(symbol.last('image')),
      enabled: await program(symbol.last('enabled')),
      font: symbol.last('text font') ? await compileFontDefinition(await store.expandRecord(symbol.last('text font').record()), loader) : null,
      alignment: symbol.last('text alignment') ? parseAlignment(symbol.text('text alignment')) : 514,
      margins: Object.fromEntries(['left', 'right', 'top', 'bottom'].map(side => [side, number(value(symbol, `text margin ${side}`, 0))])),
    });
  }
  return { name, symbols, imageSize, horizontalSpace: number(value(record, 'horizontal space', 1)), verticalSpace: number(value(record, 'vertical space', 1)), scaleText: boolean(value(record, 'scale text', false)) };
}

export function evaluateSymbolFont(definition, runtime, parent = runtime.scope) {
  if (!definition) return null;
  const scope = new MseScope(parent);
  // Relative image paths inside symbol scripts belong to the symbol package.
  for (const [name, fn] of Object.entries(imageBuiltins(definition.name))) scope.set(name, new MseFunction('native', fn));
  const evaluate = program => force(runtime.evaluate(program, scope));
  return { ...definition, symbols: definition.symbols.map(symbol => ({
    ...symbol,
    image: symbol.image ? mseImage(evaluate(symbol.image), definition.name) : null,
    enabled: symbol.enabled ? boolean(evaluate(symbol.enabled)) : true,
    font: symbol.font ? evaluateFontDefinition(symbol.font, evaluate) : null,
  })) };
}

// Declaration order wins, including when an earlier code is a shorter prefix.
// Unknown characters are skipped by native SymbolFont::split.
export function splitSymbols(font, source) {
  const output = [];
  if (!font) return output;
  for (let offset = 0; offset < source.length;) {
    let found = false;
    for (const symbol of font.symbols) {
      if (!symbol.enabled || !symbol.code) continue;
      let matched, drawn;
      if (symbol.regex) {
        const match = symbol.regex.exec(source.slice(offset));
        if (!match || match.index !== 0 || !match[0].length) continue;
        matched = match[0];
        drawn = symbol.drawText >= 0 ? match[symbol.drawText] || '' : '';
      } else {
        if (!source.startsWith(symbol.code, offset)) continue;
        matched = symbol.code;
        drawn = symbol.drawText >= 0 ? matched : '';
      }
      output.push({ symbol, text: matched, drawText: drawn, offset });
      offset += matched.length;
      found = true;
      break;
    }
    if (!found) offset += String.fromCodePoint(source.codePointAt(offset)).length;
  }
  return output;
}

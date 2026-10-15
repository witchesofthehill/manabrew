import { MseError } from './document.mjs';
import {formatMseDateTime} from './date-format.mjs';
import {formatMseNumberOrText} from './number-format.mjs';
import {MseDateTime} from './script-values.mjs';
import { sortMseText } from './sort-text.mjs';
import { regexBuiltins } from './regex-builtins.mjs';
import { collectionBuiltins, setLength } from './collection-builtins.mjs';
import { color } from './color-values.mjs';
import { choiceBuiltins } from './choice-builtins.mjs';
import { randomBuiltins } from './random-builtins.mjs';
import { tagBuiltins } from './tag-builtins.mjs';
import { editorBuiltins } from './editor-builtins.mjs';
import { spellingBuiltins } from './spelling-builtins.mjs';
import { processEnglishHints } from './english-hints.mjs';
import { englishNumber } from './english-number.mjs';
import { MseCollection, MseSet, MseDelayedError, MseFunction, MseReal, MseColor, MseFieldValue, MseKeywordParameter, boolean, number, text, code, force, typeName, conversion } from './script-values.mjs';

const optional = (scope, name, fallback) => scope.has(name) ? scope.get(name) : fallback;
const delay = fn => (...args) => { try { return fn(...args); } catch (error) { if (!(error instanceof MseError)) throw error; return new MseDelayedError(error); } };
const input = scope => scope.get('input');

function convertedNumber(value, integer = false) {
  value = force(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === '') return 0;
  if (value instanceof MseColor) {
    const mean = value.channels.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    return integer ? Math.trunc(mean) : mean;
  }
  return number(value, integer);
}

function formatValue(value,format){
  if(force(value) instanceof MseDateTime)return formatMseDateTime(force(value),format);
  return formatMseNumberOrText(value,format);
}

export function coreBuiltins({ spellcheck, spellcheckEnabled } = {}) {
  const builtins = {
    process_english_hints: scope => processEnglishHints(text(input(scope))),
    english_number: scope => englishNumber(text(input(scope))),
    english_number_a: scope => englishNumber(text(input(scope)), 'article'),
    english_number_multiple: scope => englishNumber(text(input(scope)), 'multiple'),
    english_number_ordinal: scope => englishNumber(text(input(scope)), 'ordinal'),
    is_default: scope => { const value = input(scope); if (!(value instanceof MseFieldValue)) return conversion(value, 'field value'); return value.isDefault; },
    assert: (scope, runtime, node) => {
      runtime.assertions++;
      if (!boolean(input(scope))) throw new MseError('script-assertion', 'Assertion failed', node.location);
      return null;
    },
    type_name: scope => typeName(input(scope)),
    format: scope=>formatValue(input(scope),text(scope.get('format'))),
    to_string: delay(scope => {
      const value = input(scope), format = optional(scope, 'format', null);
      if (typeof format !== 'string') return text(value);
      return formatValue(value,format);
    }),
    to_code: scope => code(input(scope)),
    to_color: delay(scope => color(input(scope))),
    to_int: delay(scope => convertedNumber(input(scope), true)),
    to_real: delay(scope => new MseReal(convertedNumber(input(scope)))),
    to_number: delay(scope => {
      const value = force(input(scope));
      if (value instanceof MseReal) return value;
      const output = convertedNumber(value);
      return Number.isInteger(output) ? output : new MseReal(output);
    }),
    to_boolean: delay(scope => typeof force(input(scope)) === 'number' ? force(input(scope)) !== 0 : boolean(input(scope))),
    abs: scope => force(input(scope)) instanceof MseReal ? new MseReal(Math.abs(number(input(scope)))) : Math.abs(number(input(scope), true)),
    reverse: scope => [...text(input(scope))].reverse().join(''),
    to_upper: scope => text(input(scope)).toUpperCase(),
    to_lower: scope => text(input(scope)).toLowerCase(),
    trim: scope => text(input(scope)).trim(),
    contains: scope => text(input(scope)).includes(text(scope.get('match'))),
    sort_text: scope => sortMseText(text(input(scope)), scope.has('order') ? text(scope.get('order')) : undefined),
    length: (scope, runtime, node) => {
      const value = force(input(scope));
      if (value instanceof MseSet) return setLength(value, scope, node);
      if (value instanceof MseKeywordParameter) return [...value.value].length;
      if (value instanceof MseCollection) return value.size;
      if (typeof value === 'string') return [...value].length;
      return conversion(value, 'collection or string');
    },
    filter_list: (scope, runtime, node) => {
      const value = force(input(scope));
      if (!(value instanceof MseCollection)) return conversion(value, 'collection');
      return new MseCollection([...value.entries()].map(([, value]) => value).filter(value => boolean(runtime.invoke(scope.get('filter'), [['input', value]], scope, node))));
    },
    ...regexBuiltins(),
    ...collectionBuiltins(),
    ...choiceBuiltins(),
    ...randomBuiltins(),
    ...tagBuiltins(),
    ...editorBuiltins(),
    ...spellingBuiltins({ spellcheck, spellcheckEnabled }),
  };
  for (const [name, fn] of Object.entries({
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    sin_deg: x => Math.sin(x * Math.PI / 180),
    cos_deg: x => Math.cos(x * Math.PI / 180),
    tan_deg: x => Math.tan(x * Math.PI / 180),
    exp: Math.exp, log: Math.log,
    log10: x => Math.log(x) / Math.log(10), sqrt: Math.sqrt,
  })) builtins[name] = scope => new MseReal(fn(number(input(scope))));
  builtins.pow = scope => new MseReal(Math.pow(number(input(scope)), number(scope.get('exponent'))));
  builtins.sort_rule = scope => new MseFunction('bound', new MseFunction('native', builtins.sort_text), scope.has('order') ? [['order', scope.get('order')]] : []);
  return builtins;
}

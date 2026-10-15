import { MseError } from './document.mjs';

export class MseDateTime {
  constructor(value) {
    const parsed=value instanceof MseDateTime?new Date(value.milliseconds):value instanceof Date?value:new Date(value);
    if(!Number.isFinite(parsed.getTime()))throw new MseError('script-date','Invalid date value');
    this.milliseconds=parsed.getTime();
  }
  toString(){
    const d=new Date(this.milliseconds),pad=n=>String(n).padStart(2,'0');
    return `${String(d.getFullYear()).padStart(4,'0')}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}
export class MseReal { constructor(value) { this.value = value; } }
export class MseImage { constructor(operation, parameters = {}) { this.operation = operation; this.parameters = parameters; } }
function sameImageData(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameImageData(a[key], b[key]));
}
export class MseColor {
  constructor(red, green, blue, alpha = 255) { this.channels = [red, green, blue, alpha].map(value => Math.trunc(value) & 255); }
}
export class MseDelayedError { constructor(error) { this.error = error; } }
export class MseObject { constructor(getMember) { this.getMember = getMember; } }
export class MseCard extends MseObject {}
export class MseFieldValue {
  constructor(value, isDefault, reference = null) { this.storedValue = value; this.storedDefault = isDefault; this.reference = reference; }
  get value() { return this.reference ? this.reference.cell.value : this.storedValue; }
  get isDefault() { return this.reference ? this.reference.cell.isDefault : this.storedDefault; }
}
export class MseKeywordParameter {
  constructor(type, value, before = '', after = '') { this.type = type; this.value = value; this.before = before; this.after = after; }
  tagged() { const type = this.type.replace(/[() ]/g, '-'); return `<param-${type}>${this.value}</param-${type}>`; }
}
const unwrap = value => value instanceof MseFieldValue ? value.value : value;
export const force = value => { value = unwrap(value); if (value instanceof MseDelayedError) throw value.error; return value; };
export function conversion(value, target) { force(value); throw new MseError('script-conversion', `Cannot convert ${typeName(value)} to ${target}`); }
export const missingMember = name => new MseDelayedError(new MseError('script-member', `No member ${name}`));

export class MseCollection {
  constructor(values = [], named = new Map()) { this.values = values; this.named = named; }
  get size() { return this.values.length + this.named.size; }
  *entries() {
    yield* this.values.map((value, index) => [index, value]);
    for (const name of [...this.named.keys()].sort()) yield [name, this.named.get(name)];
  }
  member(key) {
    if (this.named.has(key)) return this.named.get(key);
    return /^[+-]?\d+$/.test(key) && Number(key) >= 0 && Number(key) < this.values.length ? this.values[Number(key)] : missingMember(key);
  }
}
export class MseSet extends MseCollection {
  constructor(registry, getMember) { super(registry.cards.values); this.registry = registry; this.getMember = getMember; }
  member(key) { return /^\d+$/.test(key) ? super.member(key) : this.getMember(key); }
}
export class MseConcat extends MseCollection {
  constructor(left, right) { super(); this.left = left; this.right = right; }
  get size() { return this.left.size + this.right.size; }
  *entries() { yield* this.left.entries(); yield* this.right.entries(); }
  member(key) {
    const first = this.left.member(key);
    if (!(first instanceof MseDelayedError)) return first;
    const index = Number(key) - this.left.size;
    return /^[+-]?\d+$/.test(key) && index >= 0 && index < this.right.size ? this.right.member(String(index)) : this.right.member(key);
  }
}
export class MseFunction {
  constructor(kind, body, bindings = []) { this.kind = kind; this.body = body; this.bindings = bindings; }
}
export function typeName(value) {
  value = unwrap(value);
  if (value === null) return 'nil';
  if (value instanceof MseDelayedError) return 'error';
  if (value instanceof MseDateTime) return 'date';
  if (value instanceof MseReal) return 'double';
  if (value instanceof MseImage) return 'image';
  if (value instanceof MseCard) return 'card';
  if (value instanceof MseSet) return 'set';
  if (value instanceof MseKeywordParameter) return 'keyword parameter';
  if (value instanceof MseColor) return 'color';
  if (value instanceof MseCollection) return 'collection';
  if (value instanceof MseFunction) return 'function';
  return { string: 'string', number: 'integer', boolean: 'boolean' }[typeof value] || 'object';
}
export function number(value, integer = false) {
  value = force(value);
  if (value instanceof MseKeywordParameter) return number(value.value, integer);
  if (value === null) return 0;
  if (value instanceof MseReal) return integer ? Math.trunc(value.value) : value.value;
  if (typeof value === 'number') return integer ? Math.trunc(value) : value;
  if (typeof value === 'string' && (integer ? /^[+-]?\d+$/ : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i).test(value.trim())) return Number(value);
  return conversion(value, integer ? 'integer' : 'double');
}
export function boolean(value) {
  value = force(value);
  if (value instanceof MseKeywordParameter) return boolean(value.value);
  if (value === null || value === '' || value === 'false' || value === 'no') return false;
  if (value === 'true' || value === 'yes') return true;
  if (typeof value === 'boolean') return value;
  return conversion(value, 'boolean');
}
export function text(value) {
  value = force(value);
  if (value instanceof MseKeywordParameter) return value.tagged();
  if (value === null) return '';
  if (value instanceof MseDateTime) return value.toString();
  if (['string', 'number', 'boolean'].includes(typeof value)) return String(value);
  if (value instanceof MseReal) return String(value.value);
  if (value instanceof MseColor) {
    const channels = value.channels;
    return channels[3] === 255 ? `rgb(${channels.slice(0, 3).join(',')})` : `rgba(${channels.join(',')})`;
  }
  return conversion(value, 'string');
}
export function code(value) {
  value = force(value);
  if (value === null) return 'nil';
  if (typeof value === 'string') return JSON.stringify(value).replaceAll('\\u0001', '\\<').replaceAll('{', '\\{');
  if (value instanceof MseCollection) return `[${[...value.entries()].map(([key, value]) => (typeof key === 'string' ? code(key) + ':' : '') + code(value)).join(',')}]`;
  return text(value);
}
export function equal(left, right) {
  left = unwrap(left); right = unwrap(right);
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (left instanceof MseCard || right instanceof MseCard) return false;
  if (left instanceof MseSet || right instanceof MseSet) return left instanceof MseSet && right instanceof MseSet && left.registry === right.registry;
  if (left instanceof MseImage || right instanceof MseImage) return left instanceof MseImage && right instanceof MseImage && sameImageData(left, right);
  if (left instanceof MseCollection && right instanceof MseCollection) {
    const a = [...left.entries()], b = [...right.entries()];
    return a.length === b.length && a.every(([, value], i) => equal(value, b[i][1]));
  }
  if ((typeof left === 'number' || left instanceof MseReal) && (typeof right === 'number' || right instanceof MseReal)) return Math.abs(number(left) - number(right)) < 1e-14 || number(left) === number(right);
  if (left instanceof MseColor && right instanceof MseColor) return left.channels.every((n, i) => n === right.channels[i]);
  if (left instanceof MseFunction || right instanceof MseFunction) return false;
  // ScriptValue::compareAs uses toCode(), so strings retain their quotes.
  // Numeric-looking choice/slider strings must not compare equal to numbers.
  return code(left) === code(right);
}
export function member(object, key) {
  object = unwrap(object);
  if (object instanceof MseDelayedError) return object;
  object = force(object);
  key = text(key);
  if (object instanceof MseObject) return object.getMember(key);
  if (object instanceof MseKeywordParameter) {
    const names = { type: 'type', value: 'value', param: 'value', separator_before: 'before', separator_after: 'after' };
    return Object.hasOwn(names, key) ? object[names[key]] : missingMember(key);
  }
  if (object instanceof MseCollection) return object.member(key);
  if (typeof object === 'string') {
    const index = /^[\s]*[+-]?\d+$/.test(key) ? Number(key) : -1;
    const characters = [...object];
    return Number.isSafeInteger(index) && index >= 0 && index < characters.length ? characters[index] : missingMember(key);
  }
  // Only explicitly supplied data is visible; JS prototypes are never exposed.
  if (object && Object.getPrototypeOf(object) === null && Object.hasOwn(object, key)) return object[key];
  return missingMember(key);
}
export function fromHost(value) {
  if (value instanceof MseDateTime) return value;
  if (value instanceof Date) return new MseDateTime(value);
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') return Number.isInteger(value) ? value : new MseReal(value);
  if (Array.isArray(value)) return new MseCollection(value.map(fromHost));
  if (value instanceof MseFunction || value instanceof MseCollection || value instanceof MseColor || value instanceof MseReal || value instanceof MseObject || value instanceof MseFieldValue || value instanceof MseKeywordParameter || value instanceof MseImage) return value;
  if (value && typeof value === 'object') return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).map(([key, value]) => [key, fromHost(value)])));
  throw new MseError('script-host-value', `Unsupported host value ${typeof value}`);
}
export function add(left, right) {
  left = unwrap(left); right = unwrap(right);
  if (left === null) return right;
  if (right === null) return left;
  if (left instanceof MseFunction && right instanceof MseFunction) return new MseFunction('compose', [left, right]);
  if (left instanceof MseCollection && right instanceof MseCollection) return new MseConcat(left, right);
  if ((typeof left === 'number' || left instanceof MseReal) && (typeof right === 'number' || right instanceof MseReal)) {
    const value = number(left) + number(right);
    return left instanceof MseReal || right instanceof MseReal ? new MseReal(value) : value;
  }
  return text(left) + text(right);
}

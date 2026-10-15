import { MseError } from './document.mjs';

// MSE's language is parsed directly. Template code is never passed to eval,
// Function, or a JavaScript module loader.
class Lexer {
  constructor(source, location) {
    this.source = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    this.offset = 0;
    this.line = location.line || 1;
    this.location = location;
  }
  at() { return { ...this.location, line: this.line, offset: this.offset }; }
  error(message) { throw new MseError('script-syntax', message, this.at()); }
  take() { const char = this.source[this.offset++]; if (char === '\n') this.line++; return char; }
  string(quoted = true) {
    const at = this.at();
    if (quoted) this.take();
    const parts = [];
    let text = '';
    while (this.offset < this.source.length) {
      const char = this.take();
      if (quoted && char === '"') return { type: 'string', parts: [...parts, text], location: at };
      if (char === '{') {
        parts.push(text); text = '';
        parts.push(this.tokens(true));
      } else if (char === '\\') {
        if (this.offset >= this.source.length) this.error('Unterminated string escape');
        const escaped = this.take();
        const escapes = { n: '\n', r: '\r', t: '\t', '&': '', '<': '\u0001', '\\': '\\', '"': '"', "'": "'", '{': '{', '}': '}' };
        if (Object.hasOwn(escapes, escaped)) text += escapes[escaped];
        else if (/\d/.test(escaped)) {
          let number = escaped;
          while (/\d/.test(this.source[this.offset] || 'x')) number += this.take();
          text += String.fromCodePoint(Number(number));
        } else {
          // MSE retains unknown escapes (notably regular expressions).
          text += '\\' + escaped;
        }
      } else text += char;
    }
    if (quoted) this.error('Unterminated string');
    return { type: 'string', parts: [...parts, text], location: at };
  }
  tokens(interpolation = false) {
    const tokens = [];
    let newline = false, braces = 0;
    const add = token => { tokens.push({ ...token, newline }); newline = false; };
    while (this.offset < this.source.length) {
      const char = this.source[this.offset];
      if (/\s/.test(char)) { if (this.take() === '\n') newline = true; continue; }
      if (char === '#') { while (this.offset < this.source.length && this.take() !== '\n') { /* comment */ } newline = true; continue; }
      const location = this.at();
      if (char === '}' && interpolation && braces === 0) { this.take(); tokens.push({ type: 'eof', value: '', location, newline }); return tokens; }
      const include = /^include (localized |dark )?file:/.exec(this.source.slice(this.offset));
      if (include) {
        this.offset += include[0].length;
        let path = '';
        while (this.offset < this.source.length && this.source[this.offset] !== '\n') path += this.take();
        add({ type: 'include', value: path.trim(), variant: include[1]?.trim() || null, location });
      } else if (char === '"') add(this.string());
      else if (/[\p{L}_]/u.test(char) || (/\d/.test(char) && tokens.at(-1)?.value === '.')) {
        let value = this.take();
        while (/[\p{L}\p{N}_]/u.test(this.source[this.offset] || ' ')) value += this.take();
        add({ type: 'name', value, location });
      } else if (/\d/.test(char)) {
        let value = this.take();
        while (/[\d.]/.test(this.source[this.offset] || ' ')) value += this.take();
        // Native tokenization consumes every digit/dot, then ignores ToDouble's
        // return value. wxString retains a successfully parsed prefix even if
        // trailing dots remain (27.5.0 becomes 27.5); overflow leaves its zero
        // initialized output untouched.
        const real = value.includes('.');
        const parsed = real ? Number.parseFloat(value) : Number(value);
        add({ type: 'number', value: real && !Number.isFinite(parsed) ? 0 : parsed, real, location });
      } else if ('+-*/!.@%^&:=<>;,()[]{}'.includes(char)) {
        let value = this.take();
        if ([':=', '==', '!=', '<=', '>=', '->'].includes(value + this.source[this.offset])) value += this.take();
        if (value === '{') braces++;
        if (value === '}') braces--;
        add({ type: 'operator', value, location });
      } else this.error(`Unknown character ${JSON.stringify(char)}`);
    }
    if (interpolation) this.error('Unterminated string interpolation');
    tokens.push({ type: 'eof', value: '', newline, location: this.at() });
    return tokens;
  }
}

// These precedence levels follow MSE, including equal precedence for and/or,
// unary negation binding more tightly than power, and right-associative power.
const precedence = { ';': 2, ':=': 3, '->': 3, and: 4, or: 4, xor: 4, orelse: 4,
  '==': 5, '=': 5, '!=': 5, '<': 5, '>': 5, '<=': 5, '>=': 5,
  '+': 6, '-': 6, '*': 7, '/': 7, div: 7, mod: 7, '^': 8 };
const ends = new Set([')', ']', '}', ',', ':', 'then', 'else', 'of', 'do', 'in', 'to', 'from']);

class Parser {
  constructor(tokens) { this.tokens = tokens; this.index = 0; }
  peek(ahead = 0) { return this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)]; }
  is(value, ahead = 0) { const token = this.peek(ahead); return token.type !== 'string' && token.value === value; }
  take() { return this.tokens[this.index++]; }
  error(message, token = this.peek()) { throw new MseError('script-syntax', message, token.location); }
  expect(value) { if (!this.is(value)) this.error(`Expected ${value}, found ${this.peek().value ?? this.peek().type}`); return this.take(); }
  node(type, token, fields = {}) { return { type, location: token.location, ...fields }; }
  program() {
    if (this.peek().type === 'eof') return this.node('literal', this.peek(), { value: null });
    const result = this.expression(0);
    if (this.peek().type !== 'eof') this.error(`Unexpected ${this.peek().value}`);
    return result;
  }
  string(token) {
    const parts = token.parts.map(part => typeof part === 'string' ? this.node('literal', token, { value: part }) : new Parser(part).program());
    return parts.length === 1 ? parts[0] : this.node('interpolate', token, { parts });
  }
  arguments() {
    const args = [];
    while (!this.is(')')) {
      if (this.peek().type === 'eof') this.error('Unterminated argument list');
      let name = 'input';
      if (this.peek().type === 'name' && this.is(':', 1)) { name = this.take().value; this.take(); }
      args.push({ name, value: this.expression(2) });
      if (this.is(',')) this.take();
    }
    this.expect(')');
    return args;
  }
  primary() {
    const token = this.take();
    const value = token.value;
    if (token.type === 'string') return this.string(token);
    if (token.type === 'number') return this.node('literal', token, { value, real: token.real });
    if (token.type === 'include') return this.node('include', token, { path: value, variant: token.variant });
    if (value === '(') { const result = this.expression(0); this.expect(')'); return result; }
    if (value === '{') { const body = this.expression(0); this.expect('}'); return this.node('function', token, { body }); }
    if (value === '[') {
      const entries = [];
      while (!this.is(']')) {
        if (this.peek().type === 'eof') this.error('Unterminated collection');
        let key = null;
        if (['name', 'number', 'string'].includes(this.peek().type) && this.is(':', 1)) {
          const keyToken = this.take(); this.take();
          key = keyToken.type === 'string' ? this.string(keyToken) : this.node('literal', keyToken, { value: String(keyToken.value) });
        }
        entries.push({ key, value: this.expression(4) });
        if (this.is(',')) this.take();
      }
      this.expect(']');
      return this.node('collection', token, { entries });
    }
    if (value === '-' || value === 'not') return this.node('unary', token, { operator: value, value: this.expression(9) });
    if (token.type !== 'name') this.error('Expected expression', token);
    if (['true', 'false', 'nil'].includes(value)) return this.node('literal', token, { value: value === 'nil' ? null : value === 'true' });
    if (value === 'if') {
      const condition = this.expression(4); this.expect('then');
      const yes = this.expression(3);
      let no = this.node('literal', token, { value: null });
      if (this.is('else')) { this.take(); no = this.expression(3); }
      return this.node('if', token, { condition, yes, no });
    }
    if (value === 'for') {
      const each = this.is('each'); if (each) this.take();
      const variable = this.take(); if (variable.type !== 'name') this.error('Expected loop variable', variable);
      let key = null, name = variable.value;
      if (this.is(':')) { this.take(); key = name; const item = this.take(); if (item.type !== 'name') this.error('Expected loop value variable', item); name = item.value; }
      this.expect(each ? 'in' : 'from');
      const start = this.expression(4);
      let end = null;
      if (!each) { this.expect('to'); end = this.expression(4); }
      this.expect('do');
      return this.node('for', token, { each, key, name, start, end, body: this.expression(3) });
    }
    if (value === 'case') {
      const subject = this.expression(4); this.expect('of');
      const cases = [];
      let fallback = this.node('literal', token, { value: null });
      while (this.peek().type !== 'eof' && ![')', ']', '}'].some(value => this.is(value))) {
        if (this.is('else')) { this.take(); this.expect(':'); fallback = this.expression(3); break; }
        const match = this.expression(4); this.expect(':');
        cases.push({ match, value: this.expression(3) });
        if (this.is(',')) this.take();
      }
      return this.node('case', token, { subject, cases, fallback });
    }
    return this.node('variable', token, { name: value });
  }
  expression(minimum) {
    let left = this.primary();
    while (true) {
      const token = this.peek();
      if (token.type === 'eof' || (token.type !== 'string' && ends.has(token.value))) break;
      if (minimum <= 10 && this.is('.')) {
        this.take(); const key = this.take();
        if (!['name', 'string'].includes(key.type)) this.error('Expected member name', key);
        left = this.node('member', token, { object: left, key: key.type === 'string' ? this.string(key) : this.node('literal', key, { value: key.value }) });
        continue;
      }
      if (minimum <= 10 && this.is('[') && !token.newline) {
        this.take(); const key = this.expression(3); this.expect(']');
        left = this.node('member', token, { object: left, key }); continue;
      }
      if (minimum <= 10 && ((this.is('(') && !token.newline) || this.is('@'))) {
        this.take(); const bound = token.value === '@'; if (bound) this.expect('(');
        // rgb/rgba/min/max are language primitives with positional arguments.
        let args;
        if (!bound && left.type === 'variable' && ['rgb', 'rgba', 'min', 'max'].includes(left.name)) {
          args = [];
          while (!this.is(')')) {
            args.push({ name: String(args.length), value: this.expression(0) });
            if (!this.is(',')) break;
            this.take();
          }
          this.expect(')');
        } else args = this.arguments();
        if (!bound && left.type === 'variable' && left.name === 'include_file') {
          if (args.length !== 1 || args[0].value.type !== 'literal' || typeof args[0].value.value !== 'string') this.error('Include filename must be a string literal', token);
          left = this.node('include', token, { path: args[0].value.value });
        } else left = this.node(bound ? 'bind' : 'call', token, { callee: left, arguments: args });
        continue;
      }
      let operator = token.type === 'string' ? undefined : token.value;
      const level = precedence[operator];
      if (level !== undefined && level >= minimum) {
        this.take();
        if (operator === ';' && (this.peek().type === 'eof' || [')', ']', '}'].some(value => this.is(value)))) break;
        if (operator === 'or' && this.is('else')) { this.take(); operator = 'orelse'; }
        const assignment = operator === ':=' || operator === '->';
        const right = this.expression(operator === 'orelse' ? 6 : operator === '^' || assignment ? level : level + 1);
        if (assignment && left.type !== 'variable') this.error('Only variables can be assigned', token);
        left = this.node(assignment ? 'assign' : operator === ';' ? 'sequence' : 'binary', token, { operator, left, right });
        continue;
      }
      if (minimum <= 1 && token.newline) {
        left = this.node('sequence', token, { left, right: this.expression(3) }); continue;
      }
      break;
    }
    return left;
  }
}

export function parseMseScript(source, { stringMode = false, ...location } = {}) {
  const lexer = new Lexer(String(source), location);
  if (stringMode) {
    const token = lexer.string(false);
    return new Parser([]).string(token);
  }
  return new Parser(lexer.tokens()).program();
}

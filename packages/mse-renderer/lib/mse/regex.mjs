import { MseError } from './document.mjs';
import { text } from './script-values.mjs';

// Character-class fragments for Boost's standard C-locale POSIX classes.
// Locale-dependent collation and equivalence classes require a different backend.
const posix = {
  alnum: 'A-Za-z0-9', alpha: 'A-Za-z', ascii: '\\x00-\\x7f', blank: ' \\t',
  cntrl: '\\x00-\\x1f\\x7f', digit: '0-9', graph: '\\x21-\\x7e', lower: 'a-z',
  print: '\\x20-\\x7e', punct: '!-/:-@\\[-`{-~', space: ' \\t\\n\\r\\f\\v',
  upper: 'A-Z', word: 'A-Za-z0-9_', xdigit: 'A-Fa-f0-9',
};
const escape = value => value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
// Standard POSIX names, as used by Boost lookup_default_collate_name.
const collatingNames = [
  ...'NUL SOH STX ETX EOT ENQ ACK alert backspace tab newline vertical-tab form-feed carriage-return SO SI DLE DC1 DC2 DC3 DC4 NAK SYN ETB CAN EM SUB ESC IS4 IS3 IS2 IS1'.split(' '),
  ...'space exclamation-mark quotation-mark number-sign dollar-sign percent-sign ampersand apostrophe left-parenthesis right-parenthesis asterisk plus-sign comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less-than-sign equals-sign greater-than-sign question-mark commercial-at'.split(' '),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'left-square-bracket backslash right-square-bracket circumflex underscore grave-accent'.split(' '),
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'left-curly-bracket vertical-line right-curly-bracket tilde DEL'.split(' '),
];

// Script builtins such as match and replace recompile their pattern on every
// call. Translation is pure, so reuse stateless expressions (no g/y flags).
const compiled = new Map(), COMPILED_LIMIT = 1024;
export function compileMseRegex(pattern, extraFlags = '') {
  const key = text(pattern) + '\0' + extraFlags;
  const cached = compiled.get(key);
  if (cached) return cached;
  const expression = translateMseRegex(pattern, extraFlags);
  if (!/[gy]/.test(expression.flags)) {
    if (compiled.size >= COMPILED_LIMIT) compiled.delete(compiled.keys().next().value);
    compiled.set(key, expression);
  }
  return expression;
}

function translateMseRegex(pattern, extraFlags) {
  const original = text(pattern);
  let source = original, extended = false;
  // Boost's default Perl syntax treats ^/$ as line anchors and dot as matching
  // newlines. Explicit (?-m) and (?-s) disable those independent defaults.
  const flags = new Set('sm' + extraFlags);
  // MSE uses Boost's Perl grammar, including x (comments/whitespace). JS has
  // no x flag, so strip it with a lexer that preserves classes and escapes.
  while (true) {
    const mode = /^\(\?([imsx]*)(?:-([imsx]+))?\)/.exec(source);
    if (!mode || (!mode[1] && !mode[2])) break;
    for (const flag of mode[1]) { if (flag === 'x') extended = true; else flags.add(flag); }
    for (const flag of mode[2] || '') { if (flag === 'x') extended = false; else flags.delete(flag); }
    source = source.slice(mode[0].length);
  }
  let output = '', inClass = false, classStart = false;
  const scopes = [];
  const fail = message => { throw new MseError('script-regex', `${message} in ${JSON.stringify(original)}`); };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      const next = source[++i];
      if (next === undefined) fail('Trailing regex escape');
      if (next === 'Q' && !inClass) {
        const end = source.indexOf('\\E', i + 1);
        output += escape(source.slice(i + 1, end < 0 ? source.length : end));
        i = end < 0 ? source.length : end + 1;
        continue;
      }
      if (!inClass && ['A', 'z', 'Z', '<', '>', 'R'].includes(next)) {
        output += { A: '(?<![\\s\\S])', z: '(?![\\s\\S])', Z: '(?=\\n?(?![\\s\\S]))', '<': '(?<!\\w)(?=\\w)', '>': '(?<=\\w)(?!\\w)', R: '(?:\\r\\n|[\\n\\v\\f\\r\\x85\\u2028\\u2029])' }[next];
      } else if (next === 'e') output += '\\x1b';
      else if (next === 'h') output += inClass ? '\\t \\xa0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000' : '[\\t \\xa0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000]';
      else if (['K', 'G', 'g', 'C'].includes(next)) fail(`Unsupported Boost escape \\${next}`);
      else output += '\\' + next;
      classStart = false;
      continue;
    }
    if (inClass) {
      const named = /^\[:([a-z]+):\]/.exec(source.slice(i));
      const collating = /^\[\.([^\]]+)\.\]/.exec(source.slice(i));
      if (c === '[' && named) {
        if (!Object.hasOwn(posix, named[1])) fail(`Unknown POSIX class ${named[1]}`);
        output += posix[named[1]]; i += named[0].length - 1;
      } else if (c === '[' && collating) {
        const index = collatingNames.indexOf(collating[1]);
        if (index < 0) fail(`Unsupported collating element ${collating[1]}`);
        output += '\\x' + index.toString(16).padStart(2, '0');
        i += collating[0].length - 1;
      } else if (c === '[' && ['.', '=', ':'].includes(source[i + 1])) fail('Unsupported POSIX collation or class');
      else if (c === ']' && !classStart) { inClass = false; output += c; }
      else { output += c === ']' ? '\\]' : c; }
      classStart = false;
      continue;
    }
    if (extended && /\s/.test(c)) continue;
    if (extended && c === '#') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '[') {
      inClass = true; classStart = true; output += c;
      if (source[i + 1] === '^') { output += '^'; i++; }
      continue;
    }
    if (c === '(' && source.startsWith('(?#', i)) {
      const end = source.indexOf(')', i + 3);
      if (end < 0) fail('Unterminated regex comment');
      i = end; continue;
    }
    if (c === '(') {
      scopes.push(extended);
      const scoped = /^\(\?(x|-x):/.exec(source.slice(i));
      if (scoped) { extended = scoped[1] === 'x'; output += '(?:'; i += scoped[0].length - 1; continue; }
    } else if (c === ')') extended = scopes.pop() ?? extended;
    output += c;
  }
  if (inClass) fail('Unterminated character class');
  try { return new RegExp(output, [...flags].join('')); }
  catch (error) { fail(`Unsupported or invalid regex: ${error.message}`); }
}

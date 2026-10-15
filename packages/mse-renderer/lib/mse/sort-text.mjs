import { MseError } from './document.mjs';

// MSE's sort order is a small language, used especially for mana symbols.
// Slots stay in place when consumed so in_place() can restore their positions.
export function sortMseText(input, specification) {
  if (specification === undefined) return [...input].sort().join('');
  return execute(specification, [...input]);
}

function execute(spec, bag, depth = 0) {
  if (depth > 100) throw new MseError('sort-depth', 'Sort specification nesting exceeds 100');
  let cursor = 0, output = '';
  const take = () => {
    if (cursor >= spec.length) throw new MseError('sort-syntax', 'Unexpected end of sort specification');
    let value = spec[cursor++], escaped = false;
    if (value === '\\') { escaped = true; if (cursor >= spec.length) throw new MseError('sort-syntax', 'Trailing escape'); value = spec[cursor++]; }
    return { value, escaped };
  };
  const parameter = close => {
    let result = '';
    while (cursor < spec.length) {
      const { value, escaped } = take();
      if (value === close && !escaped) return result;
      if (value !== ' ') result += value;
    }
    throw new MseError('sort-syntax', `Expected ${close}`);
  };
  const rawParameter = (allowSpace = false) => {
    let nesting = 0, result = '';
    while (cursor < spec.length) {
      const token = take();
      if (!token.escaped && nesting === 0 && (token.value === ')' || (allowSpace && token.value === ' '))) return { text: result, close: token.value };
      if (!token.escaped && token.value === '(') nesting++;
      if (!token.escaped && token.value === ')') nesting--;
      result += (token.escaped ? '\\' : '') + token.value;
    }
    throw new MseError('sort-syntax', 'Expected )');
  };
  const consume = char => {
    let count = 0;
    for (let i = 0; i < bag.length; i++) if (bag[i] === char) { bag[i] = null; count++; }
    return count;
  };
  while (cursor < spec.length) {
    if (spec[cursor] === ' ') { cursor++; continue; }
    let kind, close = ')';
    const keyword = /^(once|mixed|cycle|compound|pattern|in_place|any|reverse_order|ordered)\(/.exec(spec.slice(cursor));
    if (keyword) { kind = keyword[1]; cursor += keyword[0].length; }
    else {
      const token = take();
      if (!token.escaped && ['<', '[', '('].includes(token.value)) {
        kind = { '<': 'once', '[': 'mixed', '(': 'cycle' }[token.value];
        close = { '<': '>', '[': ']', '(': ')' }[token.value];
      } else { output += token.value.repeat(consume(token.value)); continue; }
    }
    if (kind === 'in_place') {
      const sorted = [...execute(rawParameter().text, bag, depth + 1)];
      let index = 0;
      output += bag.map(char => char === null ? sorted[index++] || '' : char).join('');
      bag.length = 0;
    } else if (kind === 'reverse_order') {
      const pieces = [];
      let part;
      do { part = rawParameter(true); pieces.push(execute(part.text, bag, depth + 1)); } while (part.close !== ')');
      output += pieces.reverse().join('');
    } else if (kind === 'pattern') {
      const pattern = [];
      let terminated = false;
      while (cursor < spec.length) {
        const token = take();
        if (!token.escaped && token.value === ' ') { terminated = true; break; }
        pattern.push(!token.escaped && token.value === '.' ? null : token.value);
      }
      if (!terminated || !pattern.length) throw new MseError('sort-syntax', 'Pattern needs a pattern and a sub-specification');
      const sub = rawParameter().text;
      if (pattern.length > bag.length) continue;
      const end = bag.length - pattern.length + 1;
      const remainder = [];
      for (let pos = 0; pos < end; pos++) {
        const segment = bag.slice(pos, pos + pattern.length);
        if (segment.every((char, i) => char !== null && (pattern[i] === null || char === pattern[i]))) {
          const placeholders = segment.filter((_, i) => pattern[i] === null);
          const sorted = [...execute(sub, placeholders, depth + 1)];
          if (sorted.length === placeholders.length) {
            let index = 0;
            output += pattern.map(char => char === null ? sorted[index++] : char).join('');
            pos += pattern.length - 1;
            continue;
          }
        }
        remainder.push(bag[pos]);
      }
      // Preserve the pinned native implementation's consumed-tail behavior.
      bag.splice(0, bag.length, ...remainder);
    } else {
      const chars = [...parameter(close)];
      if (kind === 'any') { output += bag.join(''); bag.length = 0; }
      else if (kind === 'once') {
        for (const char of chars) { const index = bag.indexOf(char); if (index >= 0) { output += char; bag.splice(index, 1); } }
      } else if (kind === 'mixed') {
        for (let i = 0; i < bag.length; i++) if (chars.includes(bag[i])) { output += bag[i]; bag[i] = null; }
      } else if (kind === 'ordered') {
        for (const char of chars) output += char.repeat(consume(char));
      } else if (kind === 'compound') {
        if (!chars.length) throw new MseError('sort-syntax', 'Empty compound');
        for (let i = 0; i <= bag.length - chars.length; i++) if (chars.every((char, j) => bag[i + j] === char)) {
          output += chars.join(''); i += chars.length - 1;
          // The pinned MSE implementation marks the final slot only.
          bag[i] = null;
        }
      } else if (kind === 'cycle') {
        const counts = chars.map(consume);
        let start = 0, best = Infinity;
        for (let candidate = 0; candidate < chars.length; candidate++) {
          let score = 0, multiplier = 1;
          for (let i = 0; i < chars.length; i++) { multiplier *= 2; if (counts[(candidate + i) % chars.length]) { score = score * multiplier + 1; multiplier = 1; } }
          if (score < best) { best = score; start = candidate; }
        }
        for (let i = 0; i < chars.length; i++) { const index = (start + i) % chars.length; output += chars[index].repeat(counts[index]); }
      }
    }
  }
  return output;
}

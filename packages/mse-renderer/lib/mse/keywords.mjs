import { MseError } from './document.mjs';
import { MseScope } from './script-runtime.mjs';
import { MseFunction, MseKeywordParameter, boolean, text } from './script-values.mjs';
import { compileMseRegex as expression } from './regex.mjs';

const escape = value => value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
const untag = value => value.replace(/<[^>]*>/g, '');
function nonCapturing(source) {
  let result = '', inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') { result += c + (source[++i] || ''); continue; }
    if (c === '[') inClass = true;
    if (c === ']') inClass = false;
    result += c === '(' && !inClass && source[i + 1] !== '?' ? '(?:' : c;
  }
  return result;
}

// Consume visible characters plus closing tags, stopping before opening tags at
// the end of the span. This keeps keyword wrappers outside existing formatting.
function advance(source, start, count) {
  let i = start;
  while (i < source.length) {
    if (source[i] === '<') {
      if (!count && source[i + 1] !== '/') break;
      const end = source.indexOf('>', i);
      if (end < 0) break;
      i = end + 1;
    } else if (count > 0) { i++; count--; }
    else break;
  }
  return i;
}
function stripVisible(source, start, end) {
  let position = 0;
  return source.replace(/<[^>]*>|[^<]/g, token => token[0] === '<' ? token : (position++ >= start && position <= end ? '' : token));
}
export function cleanKeywordText(source) {
  // Reminder atoms may contain other atom tags, so balance the atom family.
  let result = '', offset = 0;
  const tags = [...source.matchAll(/<[^>]*>/g)];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (!/^<atom-(?:reminder(?:-|>)|keyword(?:-|>)|kwpph>)/.test(tag[0])) continue;
    let depth = 1, j = i + 1;
    for (; j < tags.length; j++) {
      if (/^<atom(?:-|>)/.test(tags[j][0])) depth++;
      else if (/^<\/atom(?:-|>)/.test(tags[j][0])) depth--;
      if (!depth) break;
    }
    if (depth) continue;
    result += source.slice(offset, tag.index);
    offset = tags[j].index + tags[j][0].length;
    i = j;
  }
  return (result + source.slice(offset)).replace(/<\/?(?:keyword-param|param-)[^>]*>/g, '');
}

export async function loadMseKeywords(game, loader, setKeywords = []) {
  const compile = (record, key, stringMode = false) => {
    const entry = record.last(key);
    return entry ? loader.compile(entry.text(), { ...entry.location, stringMode }) : null;
  };
  const types = new Map();
  for (const entry of game.all('keyword parameter type')) {
    const record = entry.record();
    types.set(record.text('name'), {
      name: record.text('name'), placeholder: record.text('placeholder'), match: record.text('match'),
      optional: record.text('optional') !== 'false', eat: record.text('eat separator') !== 'false',
      before: record.text('separator before is'), after: record.text('separator after is'),
      script: await compile(record, 'script'), reminderScript: await compile(record, 'reminder script'), separatorScript: await compile(record, 'separator script'),
    });
  }
  const keywords = [];
  for (const [record, fixed] of [...setKeywords.map(record => [record, false]), ...game.all('keyword').map(entry => [entry.record(), true])]) {
    const match = record.text('match') || record.text('keyword');
    const parts = []; let offset = 0;
    for (const token of match.matchAll(/<atom-param[^>]*>(.*?)<\/atom-param[^>]*>/gs)) {
      const param = types.get(token[1]);
      if (!param) throw new MseError('keyword-parameter', `Unknown keyword parameter type ${token[1]}`, record.location);
      let literal = match.slice(offset, token.index);
      if (param.eat && param.before) literal = literal.replace(expression(`(?:${param.before})$`), '');
      parts.push({ literal }, { param });
      offset = token.index + token[0].length;
      if (param.eat && param.after) offset += expression(`^(?:${param.after})`).exec(match.slice(offset))?.[0].length || 0;
    }
    parts.push({ literal: match.slice(offset) });
    // Native Boost uses a word-start assertion, not a boundary at either end.
    // A leading optional parameter must not start at the space after a word.
    const pattern = '\\<' + parts.map(part => part.param ? `(${nonCapturing(part.param.match)})${part.param.optional ? '?' : ''}` : `(${escape(part.literal)})`).join('') + '(?=$|[^a-zA-Z0-9\\(])';
    const regex = expression(pattern, 'gis');
    if (regex.test('')) throw new MseError('keyword-empty', `Keyword ${record.text('keyword')} matches empty text`);
    keywords.push({ name: record.text('keyword'), mode: record.text('mode'), parts, regex, fixed, reminder: await compile(record, 'reminder', true) });
  }
  return keywords;
}

export function keywordBuiltins(keywords, usage = new Map(), fieldKey = () => 'input') {
  const builtins = {
    expand_keywords: (scope, runtime, node) => {
      const source = cleanKeywordText(text(scope.get('input'))), plain = untag(source);
      const matches = [];
      for (const keyword of keywords) {
        runtime.tick(node);
        keyword.regex.lastIndex = 0;
        for (const match of plain.matchAll(keyword.regex)) { runtime.tick(node); matches.push({ keyword, match, position: match.index }); }
      }
      matches.sort((a, b) => a.position - b.position || Number(a.keyword.fixed) - Number(b.keyword.fixed) || b.match[0].length - a.match[0].length || (a.keyword.name < b.keyword.name ? -1 : a.keyword.name > b.keyword.name ? 1 : 0));
      const used = []; usage.set(fieldKey(), used);
      let i = 0, position = 0, cursor = 0, atom = 0, expandType = 'a', output = '';
      const skipTags = (open, close) => {
        while (source[i] === '<') {
          const end = source.indexOf('>', i) + 1;
          if (!end) return;
          const tag = source.slice(i, end);
          if (tag.startsWith('<kw-')) expandType = tag[4];
          else if (tag.startsWith('</kw-')) expandType = 'a';
          else {
            if (tag[1] === '/' ? !close : !open) return;
            if (/^<atom(?:-|>)/.test(tag)) atom++;
            if (/^<\/atom(?:-|>)/.test(tag)) atom--;
            output += tag;
          }
          i = end;
        }
      };
      while (i < source.length) {
        runtime.tick(node);
        skipTags(false, true);
        if (i >= source.length) break;
        let accepted = false;
        if (!atom) while (cursor < matches.length && matches[cursor].position <= position) {
          const candidate = matches[cursor++];
          if (candidate.position !== position) continue;
          const { keyword, match } = candidate;
          const local = new MseScope(scope);
          let end = i, total = '', placeholders = false, correctCase = true, nestedAtom = 0, valid = true;
          for (let p = 0; p < keyword.parts.length; p++) {
            const spec = keyword.parts[p], raw = match[p + 1] || '';
            const next = advance(source, end, raw.length);
            let part = source.slice(end, next).replace(/<\/kw-[^>]*>/g, '');
            if (spec.param) {
              const param = spec.param; let value = raw, before = '', after = '';
              if (param.before) {
                before = expression(`^(?:${param.before})`).exec(value)?.[0] || '';
                part = stripVisible(part, 0, before.length); value = value.slice(before.length);
              }
              if (param.after) {
                after = expression(`(?:${param.after})$`).exec(value)?.[0] || '';
                part = stripVisible(part, value.length - after.length, value.length); value = value.slice(0, value.length - after.length);
              }
              const evaluate = (program, input) => runtime.evaluate(program, new MseScope(local, [['input', input]]));
              if (param.separatorScript) { if (before) before = text(evaluate(param.separatorScript, before)); if (after) after = text(evaluate(param.separatorScript, after)); }
              const plainParam = new MseKeywordParameter(param.name, value, before, after);
              const taggedParam = new MseKeywordParameter(param.name, part, before, after);
              if (!value) {
                placeholders = true;
                plainParam.value = `<atom-kwpph>${param.placeholder || param.name}</atom-kwpph>`;
                taggedParam.value += plainParam.value;
              } else {
                if (param.script) taggedParam.value = text(evaluate(param.script, taggedParam));
                if (param.reminderScript) plainParam.value = text(evaluate(param.reminderScript, plainParam));
              }
              local.set(`param${(p + 1) / 2}`, plainParam);
              part = before + text(taggedParam) + after;
            } else correctCase &&= raw === spec.literal;
            for (const token of part.matchAll(/<[^>]*>|[^<]+/g)) {
              if (/^<atom(?:-|>)/.test(token[0])) nestedAtom++;
              else if (/^<\/atom(?:-|>)/.test(token[0])) nestedAtom--;
              else if (token[0][0] !== '<' && nestedAtom > 0 && !spec.param) valid = false;
            }
            total += part; end = next;
          }
          if (!valid) continue;
          for (const [key, value] of Object.entries({ keyword: total, mode: keyword.mode, correct_case: correctCase, used_placeholders: placeholders })) local.set(key, value);
          const evaluateOption = name => { const value = scope.get(name); return value instanceof MseFunction ? runtime.invoke(value, [], local, node) : value; };
          if (scope.has('condition') && !boolean(evaluateOption('condition'))) continue;
          const expand = expandType === '1' || (expandType !== '0' && (!scope.has('default_expand') || boolean(evaluateOption('default_expand'))));
          const state = expandType === '0' || expandType === '1' ? expandType : expand ? 'A' : 'a';
          local.set('expand', expand);
          local.set('reminder', keyword.reminder ? runtime.evaluate(keyword.reminder, local) : '');
          output += `<kw-${state}>${text(evaluateOption('combine'))}</kw-${state}>`;
          used.push(keyword.name);
          position += match[0].length; i = end; accepted = true; break;
        }
        if (!accepted) { skipTags(true, true); if (i >= source.length) break; output += source[i++]; position++; }
        skipTags(true, false);
      }
      return output;
    },
    keyword_usage: scope => {
      const values = [...usage.values()].flat();
      return (scope.has('unique') && boolean(scope.get('unique')) ? [...new Set(values)] : values).join(', ');
    },
  };
  builtins.expand_keywords_rule = scope => new MseFunction('bound', new MseFunction('native', builtins.expand_keywords), ['condition', 'default_expand', 'combine'].filter(name => scope.has(name)).map(name => [name, scope.get(name)]));
  return builtins;
}

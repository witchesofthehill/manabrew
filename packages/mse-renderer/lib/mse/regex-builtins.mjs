import { MseError } from './document.mjs';
import { MseCollection, MseFunction, boolean, text } from './script-values.mjs';
import { compileMseRegex as regex } from './regex.mjs';

function* matches(source, expression, context, runtime, node) {
  let offset = 0;
  while (offset <= source.length) {
    runtime.tick(node);
    const match = expression.exec(source.slice(offset));
    if (!match) return;
    const index = offset + match.index;
    const end = index + match[0].length;
    if (!context || context.test(source.slice(0, index) + '<match>' + source.slice(end))) yield { match, index, end };
    if (end === offset) throw new MseError('script-regex-empty', 'Regular expression matches an empty string without advancing', node.location);
    offset = end;
  }
}

function sedReplacement(replacement, match) {
  return replacement.replace(/\\(.)|&/gs, (_, escaped) => escaped === undefined ? match[0] : /[0-9]/.test(escaped) ? match[Number(escaped)] || '' : escaped);
}

export function regexBuiltins() {
  const builtins = {
    match: scope => regex(scope.get('match')).test(text(scope.get('input'))),
    break_text: (scope, runtime, node) => new MseCollection([...matches(text(scope.get('input')), regex(scope.get('match')), scope.has('in_context') ? regex(scope.get('in_context')) : null, runtime, node)].map(({ match }) => match[0])),
    filter_text: (scope, runtime, node) => builtins.break_text(scope, runtime, node).values.join(''),
    split_text: (scope, runtime, node) => {
      const source = text(scope.get('input'));
      const includeEmpty = !scope.has('include_empty') || boolean(scope.get('include_empty'));
      const parts = []; let offset = 0;
      for (const match of matches(source, regex(scope.get('match')), null, runtime, node)) {
        if (includeEmpty || match.index !== offset) parts.push(source.slice(offset, match.index));
        offset = match.end;
      }
      if (includeEmpty || offset !== source.length) parts.push(source.slice(offset));
      return new MseCollection(parts);
    },
    replace: (scope, runtime, node) => {
      const expression = regex(scope.get('match'));
      const context = scope.has('in_context') ? regex(scope.get('in_context')) : null;
      const replacement = scope.get('replace');
      const recursive = scope.has('recursive') && boolean(scope.get('recursive'));
      const apply = (source, level) => {
        let output = '', offset = 0;
        for (const { match, index, end } of matches(source, expression, context, runtime, node)) {
          let inside = replacement instanceof MseFunction
            ? text(runtime.invoke(replacement, Array.from(match, (value, i) => [i === 0 ? 'input' : `_${i}`, value || '']), scope, node))
            : sedReplacement(text(replacement), match);
          if (recursive && level < 20) inside = apply(inside, level + 1);
          output += source.slice(offset, index) + inside;
          offset = end;
        }
        return output + source.slice(offset);
      };
      return apply(text(scope.get('input')), 0);
    },
  };
  for (const [rule, fn, names] of [
    ['match_rule', 'match', ['match']],
    ['break_rule', 'break_text', ['match', 'in_context']],
    ['filter_rule', 'filter_text', ['match', 'in_context']],
    ['replace_rule', 'replace', ['match', 'in_context', 'replace', 'recursive']],
  ]) builtins[rule] = scope => new MseFunction('bound', new MseFunction('native', builtins[fn]), names.filter(name => scope.has(name)).map(name => [name, scope.get(name)]));
  builtins.replace_text = builtins.replace;
  builtins.match_text = builtins.match;
  return builtins;
}

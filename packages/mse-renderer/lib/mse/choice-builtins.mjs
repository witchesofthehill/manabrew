import { text } from './script-values.mjs';

function choices(value) {
  if (!value) return [];
  const parts = value.split(',');
  if (parts.at(-1) === '') parts.pop();
  return parts.map(part => part.replace(/^ +/, ''));
}
function parameters(scope) {
  if (scope.has('choices')) return choices(text(scope.get('choices')));
  if (scope.has('choice')) return [text(scope.get('choice'))];
  const result = [];
  for (let i = 1; scope.has(`choice${i}`); i++) result.push(text(scope.get(`choice${i}`)));
  return result;
}
function filter(scope, minimum, maximum) {
  const value = text(scope.get('input')), allowed = parameters(scope);
  if (!allowed.length) return value;
  const preferred = scope.has('last_change') ? text(scope.get('last_change')) : '';
  const seen = new Set(), remaining = [];
  for (const part of choices(value)) {
    // The native filter uses prefix matching; chosen() below uses exact text.
    const index = allowed.findIndex((choice, i) => !seen.has(i) && part.startsWith(choice));
    if (index < 0) remaining.push(part); else seen.add(index);
  }
  if (seen.size < minimum) {
    const index = allowed.indexOf(preferred);
    if (index >= 0) seen.add(index);
    for (let i = 0; i < allowed.length && seen.size < minimum; i++) seen.add(i);
  }
  for (let i = allowed.length - 1; i >= 0 && seen.size > maximum; i--) {
    if (maximum > 0 && allowed[i] === preferred) continue;
    seen.delete(i);
  }
  return [...remaining, ...allowed.filter((_, i) => seen.has(i))].join(', ');
}
export function choiceBuiltins() {
  return {
    chosen: scope => choices(text(scope.get('input'))).includes(text(scope.get('choice'))),
    count_chosen: scope => {
      const value = text(scope.get('input'));
      return scope.has('choices') ? choices(text(scope.get('choices'))).filter(choice => choices(value).includes(choice)).length : value === '' ? 0 : value.split(',').length;
    },
    require_choice: scope => filter(scope, 1, Infinity),
    exclusive_choice: scope => filter(scope, 0, 1),
    require_exclusive_choice: scope => filter(scope, 1, 1),
    remove_choice: scope => filter(scope, 0, 0),
  };
}

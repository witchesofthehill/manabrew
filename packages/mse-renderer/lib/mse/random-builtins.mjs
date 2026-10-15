import { MseError } from './document.mjs';
import { MseCollection, MseFunction, MseReal, boolean, number, force, conversion } from './script-values.mjs';
const get = (scope, name, fallback) => scope.has(name) ? scope.get(name) : fallback;
function values(scope) {
  const value = force(scope.get('input'));
  if (!(value instanceof MseCollection)) return conversion(value, 'collection');
  return [...value.entries()].map(([, value]) => value);
}
function shuffle(list, runtime, node) {
  for (let i = list.length - 1; i > 0; i--) {
    runtime.tick(node);
    const j = Math.floor(runtime.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
export function randomBuiltins() {
  return {
    random_real: (scope, runtime) => {
      const begin = number(get(scope, 'begin', 0)), end = number(get(scope, 'end', 1));
      return new MseReal(begin + runtime.random() * (end - begin));
    },
    random_int: (scope, runtime) => {
      const begin = number(get(scope, 'begin', 0), true), end = number(scope.get('end'), true);
      if (end <= begin) throw new MseError('script-random-range', 'Random range must have end > begin');
      return begin + Math.floor(runtime.random() * (end - begin));
    },
    random_boolean: (scope, runtime) => runtime.random() < number(get(scope, 'input', new MseReal(0.5))),
    random_select: (scope, runtime) => {
      const list = values(scope);
      if (!list.length) throw new MseError('script-random-empty', 'Cannot select from an empty collection');
      return list[Math.floor(runtime.random() * list.length)];
    },
    random_shuffle: (scope, runtime, node) => new MseCollection(shuffle(values(scope), runtime, node)),
    random_select_many: (scope, runtime, node) => {
      const list = values(scope), count = number(scope.get('count'), true);
      const replacement = get(scope, 'replace', false);
      const withReplacement = !(replacement instanceof MseFunction) && boolean(replacement);
      if (count < 0 || (!withReplacement && count > list.length) || (withReplacement && !list.length)) throw new MseError('script-random-count', 'Cannot select the requested count');
      if (!withReplacement) return new MseCollection(shuffle(list, runtime, node).slice(0, count));
      const result = [];
      for (let i = 0; i < count; i++) { runtime.tick(node); result.push(list[Math.floor(runtime.random() * list.length)]); }
      return new MseCollection(result);
    },
  };
}

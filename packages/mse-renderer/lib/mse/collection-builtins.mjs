import { MseCollection, MseSet, MseFunction, boolean, text, force, equal, conversion } from './script-values.mjs';
import { MseError } from './document.mjs';

function forCard(set, card, fn, node) {
  const context = set.registry.byObject.get(card).context;
  return fn instanceof MseFunction ? context.runtime.invoke(fn, [], context.runtime.scope, node) : fn;
}
export function setLength(value, scope, node) {
  const filter = scope.has('filter') ? force(scope.get('filter')) : null;
  return filter === null ? value.size : value.values.filter(card => boolean(forCard(value, card, filter, node))).length;
}

// Deterministic natural ordering: numeric runs compare by width, then digits.
// This deliberately does not use localeCompare, whose result varies by host.
export function smartCompare(a, b) {
  const normalized = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('æ', 'ae').replaceAll('œ', 'oe').replaceAll('ĳ', 'ij');
  a = normalized(a); b = normalized(b);
  let left = 0, right = 0;
  while (left < a.length && right < b.length) {
    const x = /^\d+/.exec(a.slice(left)), y = /^\d+/.exec(b.slice(right));
    if (x && y) {
      if (x[0].length !== y[0].length) return Math.sign(x[0].length - y[0].length);
      if (x[0] !== y[0]) return x[0] < y[0] ? -1 : 1;
      left += x[0].length; right += y[0].length;
    } else {
      if (a[left] !== b[right]) return a[left] < b[right] ? -1 : 1;
      left++; right++;
    }
  }
  return Math.sign((a.length - left) - (b.length - right));
}

export function collectionBuiltins() {
  return {
    sort_list: (scope, runtime, node) => {
      const input = force(scope.get('input'));
      const unique = scope.has('remove_duplicates') && boolean(scope.get('remove_duplicates'));
      if (typeof input === 'string') {
        const sorted = [...input].sort();
        return (unique ? [...new Set(sorted)] : sorted).join('');
      }
      if (!(input instanceof MseCollection)) return conversion(input, 'collection');
      const order = scope.has('order_by') ? scope.get('order_by') : null;
      const rows = [...input.entries()].map(([, value]) => ({ value, key: text(runtime.invoke(order, [[input instanceof MseSet ? 'card' : 'input', value]], scope, node)) }));
      rows.sort((a, b) => smartCompare(a.key, b.key));
      return new MseCollection(rows.filter((row, i) => !unique || !i || smartCompare(row.key, rows[i - 1].key) !== 0).map(row => row.value));
    },
    position: (scope, runtime, node) => {
      const container = force(scope.get('in')), value = scope.get('of');
      if (typeof container === 'string' && typeof value === 'string') return container.indexOf(value);
      if (!(container instanceof MseCollection)) return conversion(container, 'collection');
      const order = scope.has('order_by') ? force(scope.get('order_by')) : null;
      const filter = scope.has('filter') ? force(scope.get('filter')) : null;
      if (order !== null || filter !== null) {
        if (!(container instanceof MseSet)) throw new MseError('script-position', 'position order_by and filter require a set');
        const rows = container.values.map(card => ({ card, key: order === null ? '' : text(forCard(container, card, order, node)), keep: filter === null || boolean(forCard(container, card, filter, node)) }));
        return rows.filter(row => row.keep).sort((a, b) => smartCompare(a.key, b.key)).findIndex(row => equal(value, row.card));
      }
      return [...container.entries()].findIndex(([, item]) => equal(value, item));
    },
    number_of_items: (scope, runtime, node) => {
      const value = force(scope.get('in'));
      if (value instanceof MseSet) return setLength(value, scope, node);
      if (value instanceof MseCollection) return value.size;
      if (typeof value === 'string') return [...value].length;
      return conversion(value, 'collection');
    },
  };
}

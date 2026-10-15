import { MseError } from './document.mjs';
import { parseMseScript } from './script-parser.mjs';
import { MseCollection, MseFunction, MseReal, MseColor, MseDelayedError, MseFieldValue, fromHost, force, boolean, number, text, equal, member, add } from './script-values.mjs';

export class MseScope {
  constructor(parent = null, entries = []) { this.parent = parent; this.values = new Map(); this.globals = parent?.globals || new Map(); for (const [name, value] of entries) this.set(name, value); }
  has(name) { return this.globals.has(name) || this.values.has(name) || Boolean(this.parent?.has(name)); }
  get(name) {
    if (this.globals.has(name)) return this.globals.get(name);
    if (this.values.has(name)) return this.values.get(name);
    if (this.parent) return this.parent.get(name);
    throw new MseError('script-variable', `No variable ${name}`);
  }
  set(name, value) { (this.globals.has(name) ? this.globals : this.values).set(name, value); return value; }
  setGlobal(name, value) { this.globals.set(name, value); return value; }
}

export class MseRuntime {
  constructor({ variables = {}, builtins = {}, maxSteps = 1000000, maxDepth = 200, random = Math.random } = {}) {
    this.scope = new MseScope(null, Object.entries(variables).map(([key, value]) => [key, fromHost(value)]));
    for (const [name, fn] of Object.entries(builtins)) this.scope.set(name, new MseFunction('native', fn));
    this.maxSteps = maxSteps; this.maxDepth = maxDepth;
    this.steps = 0; this.depth = 0; this.executionDepth = 0; this.assertions = 0;
    this.random = random;
  }
  run(script, location = {}) {
    return this.evaluate(typeof script === 'string' ? parseMseScript(script, location) : script, this.scope);
  }
  withBudget(operation) {
    // Host-driven field/font evaluations are separate executions. Nested
    // scripts and callbacks share their caller's budget, including run().
    if (this.executionDepth === 0) this.steps = 0;
    this.executionDepth++;
    try { return operation(); } finally { this.executionDepth--; }
  }
  tick(node) {
    if (++this.steps > this.maxSteps) throw new MseError('script-budget', 'Script instruction budget exceeded', node?.location);
  }
  invoke(fn, entries, parent, node) {
    return this.withBudget(() => this.invokeWithinBudget(fn, entries, parent, node));
  }
  invokeWithinBudget(fn, entries, parent, node) {
    this.tick(node);
    if (++this.depth > this.maxDepth) { this.depth--; throw new MseError('script-depth', 'Script call depth exceeded', node?.location); }
    try {
      // MSE pushes arguments then installs them in reverse, so the first
      // occurrence wins when a parameter name is repeated.
      const scope = new MseScope(parent, [...entries].reverse());
      return this.callInScope(fn, scope, node);
    } finally { this.depth--; }
  }
  callInScope(fn, scope, node) {
    if (fn instanceof MseFieldValue) fn = fn.value;
    if (fn instanceof MseDelayedError) return fn;
    fn = force(fn);
    if (fn === null) return scope.get('input');
    if (!(fn instanceof MseFunction)) return new MseDelayedError(new MseError('script-call', 'Value is not callable', node?.location));
    if (fn.kind === 'bound') {
      for (const [name, value] of fn.bindings) if (!scope.values.has(name)) scope.set(name, value);
      return this.callInScope(fn.body, scope, node);
    }
    if (fn.kind === 'native') return fn.body(scope, this, node);
    if (fn.kind === 'compose') {
      const first = this.invoke(fn.body[0], [], scope, node);
      return this.invoke(fn.body[1], [['input', first]], scope, node);
    }
    return this.evaluate(fn.body, scope);
  }
  evaluate(node, scope) {
    return this.withBudget(() => this.evaluateWithinBudget(node, scope));
  }
  evaluateWithinBudget(node, scope) {
    this.tick(node);
    const run = child => this.evaluate(child, scope);
    try {
      switch (node.type) {
        case 'literal': return node.real ? new MseReal(node.value) : node.value;
        case 'variable': return scope.get(node.name);
        case 'assign': return node.operator === '->' ? scope.setGlobal(node.left.name, run(node.right)) : scope.set(node.left.name, run(node.right));
        case 'sequence': {
          // Long init scripts are left-deep ASTs. Walk their sequences without
          // consuming the host call stack for every top-level assignment.
          const pending = [node]; let result = null;
          while (pending.length) {
            const item = pending.pop();
            if (item.type === 'sequence') { this.tick(item); pending.push(item.right, item.left); }
            else result = run(item);
          }
          return result;
        }
        case 'function': return new MseFunction('script', node.body);
        case 'member': return member(run(node.object), run(node.key));
        case 'collection': {
          const values = [], named = new Map();
          for (const entry of node.entries) {
            const key = entry.key ? text(run(entry.key)) : null;
            const value = run(entry.value);
            if (key === null) values.push(value); else named.set(key, value);
          }
          return new MseCollection(values, named);
        }
        case 'interpolate': {
          // Empty leading/trailing literal parts are elided by MSE: a field
          // consisting solely of {expression} retains the expression's type.
          const parts = node.parts.filter(part => !(part.type === 'literal' && part.value === ''));
          return parts.reduce((value, part) => add(value, run(part)), null) ?? '';
        }
        case 'if': return run(boolean(run(node.condition)) ? node.yes : node.no);
        case 'case': {
          const subject = run(node.subject);
          for (const entry of node.cases) if (equal(subject, run(entry.match))) return run(entry.value);
          return run(node.fallback);
        }
        case 'unary': {
          const value = force(run(node.value));
          return node.operator === 'not' ? !boolean(value) : value instanceof MseReal ? new MseReal(-number(value)) : -number(value, true);
        }
        case 'binary': {
          const left = run(node.left);
          if (node.operator === 'and') return boolean(left) ? run(node.right) : left;
          if (node.operator === 'or') return boolean(left) ? left : run(node.right);
          const right = run(node.right);
          if (node.operator === 'orelse') return left instanceof MseDelayedError ? right : left;
          if (node.operator === '+') return add(left, right);
          if (['=', '==', '!='].includes(node.operator)) return equal(left, right) !== (node.operator === '!=');
          if (node.operator === 'xor') return boolean(left) !== boolean(right);
          const a = number(left), b = number(right);
          if (b === 0 && ['div', 'mod'].includes(node.operator)) return new MseReal(a / b);
          const operations = { '-': () => a - b, '*': () => a * b, '/': () => a / b, div: () => Math.trunc(a / b), mod: () => a % b, '^': () => a ** b, '<': () => a < b, '>': () => a > b, '<=': () => a <= b, '>=': () => a >= b };
          if (!operations[node.operator]) throw new MseError('script-operator', `Unsupported operator ${node.operator}`);
          const value = operations[node.operator]();
          return typeof value === 'number' && node.operator !== 'div' && (node.operator === '/' || force(left) instanceof MseReal || force(right) instanceof MseReal || !Number.isInteger(value)) ? new MseReal(value) : value;
        }
        case 'for': {
          let iterator;
          const start = force(run(node.start));
          if (node.each) {
            if (!(start instanceof MseCollection)) throw new MseError('script-iterator', 'Loop requires a collection');
            iterator = start.entries();
          } else {
            const low = number(start, true), high = number(run(node.end), true);
            iterator = (function* () { for (let value = low; value <= high; value++) yield [value - low, value]; })();
          }
          let result = null;
          for (const [key, value] of iterator) {
            this.tick(node);
            if (node.key) scope.set(node.key, key);
            scope.set(node.name, value);
            result = add(result, run(node.body));
          }
          return result;
        }
        case 'bind': case 'call': {
          const primitive = node.callee.type === 'variable' && ['rgb', 'rgba', 'min', 'max'].includes(node.callee.name);
          const fn = primitive ? null : run(node.callee);
          const args = node.arguments.map(arg => [arg.name, run(arg.value)]);
          if (primitive) {
            const values = args.map(([, value]) => number(value, node.callee.name.startsWith('rgb')));
            if (node.callee.name.startsWith('rgb')) return new MseColor(...values);
            const value = Math[node.callee.name](...values);
            return args.some(([, value]) => force(value) instanceof MseReal) ? new MseReal(value) : value;
          }
          return node.type === 'bind' ? new MseFunction('bound', fn, args) : this.invoke(fn, args, scope, node);
        }
        default: throw new MseError('script-node', `Unsupported AST node ${node.type}`, node.location);
      }
    } catch (error) {
      if (error instanceof MseError && !error.location.file) {
        const located = new MseError(error.code, error.message.replace(/^<mse>:\d+: /, ''), node.location);
        located.cause = error; throw located;
      }
      throw error;
    }
  }
}

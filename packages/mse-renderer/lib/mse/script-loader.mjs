import { MseError } from './document.mjs';
import { resolveMsePath } from './packages.mjs';
import { parseMseScript } from './script-parser.mjs';

export class MseScriptLoader {
  constructor(store) { this.store = store; this.parsed = new Map(); }
  async parseFile(path) {
    if (!this.parsed.has(path.key)) {
      const promise = Promise.resolve().then(() => this.store.readText(path))
        .then(source => parseMseScript(source, { file: path.key, package: path.package }))
        .catch(error => { this.parsed.delete(path.key); throw error; });
      this.parsed.set(path.key, promise);
    }
    return this.parsed.get(path.key);
  }
  // Reader::handle(Scriptable<T>): an explicit prefix selects expression mode;
  // otherwise braces interpolate the scalar's literal text.
  async compileScriptable(source, location = {}) {
    source = String(source);
    return source.startsWith('script:')
      ? this.compile(source.slice(7), { ...location, stringMode: false })
      : this.compile(source, { ...location, stringMode: true });
  }
  async compile(source, location = {}) {
    return this.expand(parseMseScript(source, location), []);
  }
  async expand(value, chain) {
    const result = {};
    const pending = [{ value, target: result, key: 'value', chain }];
    while (pending.length) {
      const task = pending.pop();
      const item = task.value;
      if (!item || typeof item !== 'object') { task.target[task.key] = item; continue; }
      if (item.type === 'include') {
        const path = resolveMsePath(this.store.includePath(item.path, item.variant), item.location.package);
        if (task.chain.includes(path.key)) throw new MseError('script-include-cycle', [...task.chain, path.key].join(' -> '), item.location);
        pending.push({ ...task, value: await this.parseFile(path), chain: [...task.chain, path.key] });
        continue;
      }
      const output = Array.isArray(item) ? [] : {};
      task.target[task.key] = output;
      for (const [key, child] of Object.entries(item).reverse()) {
        if (key === 'location') output[key] = child;
        else pending.push({ value: child, key, target: output, chain: task.chain });
      }
    }
    return result.value;
  }
}

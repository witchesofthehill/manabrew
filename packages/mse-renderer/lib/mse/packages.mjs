import { MseError, MseRecord, parseMseDocument } from './document.mjs';

const entrypoints = new Map([
  ['mse-game', 'game'], ['mse-style', 'style'], ['mse-include', 'include'],
  ['mse-symbol-font', 'symbol-font'], ['mse-export-template', 'export-template'],
  ['mse-locale', 'locale'],
]);

// MSE relative references are rooted at the owning package, even when they
// occur inside a file in a subdirectory. Cross-package paths start with '/'.
export function resolveMsePath(reference, owner, {allowEmptyFile=false}={}) {
  const path = String(reference).replaceAll('\\', '/').replace(/^\/+/, '/');
  let packageName = owner;
  let file = path;
  if (path.startsWith('/')) {
    const slash = path.indexOf('/', 1);
    if (slash < 0) throw new MseError('invalid-path', `Missing file in ${path}`);
    packageName = path.slice(1, slash);
    file = path.slice(slash + 1);
  }
  if (!packageName || /[/\\\0]/.test(packageName) || ['.', '..'].includes(packageName)) {
    throw new MseError('invalid-package', `Invalid package name ${packageName}`);
  }
  const parts = [];
  for (const part of file.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new MseError('invalid-path', `Path leaves package: ${path}`);
      parts.pop();
    } else {
      if (part.includes('\0')) throw new MseError('invalid-path', 'NUL in package path');
      parts.push(part);
    }
  }
  if (!parts.length&&!allowEmptyFile) throw new MseError('invalid-path', `Missing file in ${path}`);
  return { package: packageName, file: parts.join('/'), key: `${packageName}/${parts.join('/')}` };
}

export function compareMseVersions(left, right) {
  const parts = value => String(value).split(/[.-]/).map(Number);
  const a = parts(left), b = parts(right);
  if ([...a, ...b].some(n => !Number.isInteger(n) || n < 0)) {
    throw new MseError('invalid-version', `Cannot compare ${left} with ${right}`);
  }
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return Math.sign((a[i] || 0) - (b[i] || 0));
  }
  return 0;
}

export class MsePackageStore {
  // Transport injection supports local build tools and browser fetch without
  // letting a template access the host filesystem or evaluate JavaScript.
  constructor({ readText, assetUrl, locale = 'en', dark = false, files = null }) {
    this.readText = readText;
    this.assetUrl = assetUrl;
    this.locale = locale;
    this.dark = dark;
    this.files = files === null ? null : new Set(files);
    this.installedPackages = this.files && new Set([...this.files].map(key => key.split('/')[0]));
    this.documents = new Map();
    this.packages = new Map();
  }
  includePath(reference, variant) {
    return reference + (variant === 'localized' ? `_${this.locale}` : variant === 'dark' && this.dark ? '_dark' : '');
  }
  document(reference, owner) {
    const path = resolveMsePath(reference, owner);
    if (!this.documents.has(path.key)) {
      const request = Promise.resolve().then(() => this.readText(path))
        .then(text => parseMseDocument(text, { package: path.package, file: path.key }))
        .catch(error => { this.documents.delete(path.key); throw error; });
      this.documents.set(path.key, request);
    }
    return this.documents.get(path.key);
  }
  async package(name) {
    if (!this.packages.has(name)) {
      const entry = entrypoints.get(name.slice(name.lastIndexOf('.') + 1));
      if (!entry) throw new MseError('unknown-package-type', `Unknown package type ${name}`);
      const request = this.document(entry, name).then(document => ({
        name, document, version: document.text('version', '0'),
        mseVersion: document.text('mse version', '0'),
        dependencies: document.all('depends on').map(entry => {
          if (entry.inline) {
            const [name, version = '0'] = entry.inline.trim().split(/\s+/);
            return { name, version };
          }
          const record = entry.record();
          return { name: record.text('package'), version: record.text('version', '0'), suggests: ['true', 'yes', '1'].includes(record.text('suggests')) };
        }),
      })).catch(error => { this.packages.delete(name); throw error; });
      this.packages.set(name, request);
    }
    return this.packages.get(name);
  }
  async dependencyClosure(name) {
    const found = new Map();
    const visiting = new Set();
    const visit = async (name, required = '0') => {
      const pkg = await this.package(name);
      if (compareMseVersions(pkg.version, required) < 0) {
        throw new MseError('dependency-version', `${name} requires ${required}, installed ${pkg.version}`);
      }
      // Package dependencies describe installation requirements, not script
      // execution order. Real MSE packages have valid mutual dependencies.
      if (visiting.has(name)) return;
      if (found.has(name)) return;
      visiting.add(name);
      for (const dependency of pkg.dependencies) {
        if (!dependency.suggests) await visit(dependency.name, dependency.version);
      }
      visiting.delete(name);
      found.set(name, pkg);
    };
    await visit(name);
    return [...found.values()];
  }
  async expandRecord(record, chain = []) {
    const warnings = [...record.warnings];
    const entries = [];
    for (const entry of record.entries) {
      if (!['include_file', 'include_dark_file', 'include_localized_file'].includes(entry.key)) { entries.push(entry); continue; }
      const reference = this.includePath(entry.text(), entry.key.split('_')[1]);
      const path = resolveMsePath(reference, entry.location.package);
      if (chain.includes(path.key)) throw new MseError('include-cycle', [...chain, path.key].join(' -> '), entry.location);
      const included = await this.document(reference, entry.location.package);
      const expanded = await this.expandRecord(included, [...chain, path.key]);
      warnings.push(...expanded.warnings);
      // Version declarations describe the included document, not its host.
      entries.push(...expanded.entries.filter(item => item.key !== 'mse_version'));
    }
    return new MseRecord(entries, record.location, warnings);
  }
  asset(reference, owner) { return this.assetUrl(resolveMsePath(reference, owner)); }
  exists(reference) {
    if (!String(reference).startsWith('/')) throw new MseError('package-path', "No package name specified; use '/package/filename'");
    if (!this.files) throw new MseError('package-index', 'A complete package file index is required for exists_in_package');
    // PackageManager::existsInPackage accepts an empty filename. contains("")
    // then returns false; actual file loading still requires a nonempty path.
    const path = resolveMsePath(reference,undefined,{allowEmptyFile:true});
    if (!this.installedPackages.has(path.package)) throw new MseError('package-missing', `Package ${path.package} is not installed`);
    return this.files.has(path.key);
  }
}

export function createFetchMseStore(baseUrl, fetcher = globalThis.fetch, { files = null } = {}) {
  const base = new URL(baseUrl);
  const urlFor = path => new URL(path.key.split('/').map(encodeURIComponent).join('/'), base).href;
  if (!base.pathname.endsWith('/')) throw new MseError('invalid-base-url', 'Package base URL must end in /');
  return new MsePackageStore({
    files,
    assetUrl: urlFor,
    readText: async path => {
      const response = await fetcher(urlFor(path));
      if (!response.ok) throw new MseError('package-fetch', `HTTP ${response.status} loading ${path.key}`);
      return response.text();
    },
  });
}

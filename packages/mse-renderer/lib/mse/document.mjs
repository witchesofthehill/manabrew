// MSE records are ordered and may repeat. An indented block can be either a
// record or literal text/script: keep it raw until the consuming schema decides.
export const canonicalName = name => String(name).replaceAll(' ', '_');

export class MseError extends Error {
  constructor(code, message, location = {}) {
    super(`${location.file || '<mse>'}:${location.line || 1}: ${message}`);
    this.name = 'MseError';
    this.code = code;
    this.location = location;
  }
}

export class MseRecord {
  constructor(entries, location, warnings = []) {
    this.entries = entries;
    this.location = location;
    this.warnings = warnings;
  }
  all(name) { return this.entries.filter(entry => entry.key === canonicalName(name)); }
  last(name) { return this.all(name).at(-1); }
  text(name, fallback = '') { return this.last(name)?.text() ?? fallback; }
}

class MseEntry {
  constructor(key, inline, block, location) {
    this.key = key;
    this.inline = inline;
    this.block = block;
    this.location = location;
  }
  text() {
    // A nonempty inline string wins; child records remain available to schemas
    // which use a named object followed by indented properties.
    if (this.inline) return this.inline;
    const boundary = this.block.findIndex(line => line.outsideComment);
    const lines = this.block.slice(0, boundary < 0 ? undefined : boundary);
    while (lines.length && !lines.at(-1).text.trim()) lines.pop();
    return lines.map(line => line.text).join('\n');
  }
  record() { return parseLines(this.block, this.location); }
}

function parseLines(lines, location) {
  const entries = [];
  const warnings = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i++];
    if (!line.text.trim() || line.text.startsWith('#')) continue;
    const at = { ...location, line: line.number };
    if (/^[\t ]/.test(line.text)) {
      throw new MseError('indentation', 'Expected a record key; MSE indentation uses tabs', at);
    }
    const colon = line.text.indexOf(':');
    // Reader::readLine keeps a colonless key with an empty value and warns.
    // Its indented children still belong to that record (e.g. Space Xerent's
    // paintbrush style); rejecting the whole package loses valid content.
    if (colon < 0) warnings.push(new MseError('missing-colon', 'Expected key: value', at));
    const key = canonicalName((colon < 0 ? line.text : line.text.slice(0, colon)).trim()) || ' ';
    const inline = colon < 0 ? '' : line.text.slice(colon + 1).trimStart();
    const block = [];
    while (i < lines.length) {
      const next = lines[i];
      if (next.text.startsWith('\t')) {
        block.push({ ...next, text: next.text.slice(1) });
        i++;
      } else if (next.text.startsWith('#')) {
        // Record comments are ignored at any indentation. For a scalar string,
        // an unindented comment ends its value (Reader::getValue semantics).
        block.push({ ...next, outsideComment: true });
        i++;
      } else if (!next.text.trim()) {
        block.push({ text: '', number: next.number });
        i++;
      } else break;
    }
    entries.push(new MseEntry(key, inline, block, at));
  }
  return new MseRecord(entries, location, warnings);
}

export function parseMseDocument(source, location = {}) {
  const lines = String(source).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
    .map((text, index) => ({ text, number: (location.line || 1) + index }));
  return parseLines(lines, location);
}

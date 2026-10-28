import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { TraceMap, decodedMappings, originalPositionFor } from "@jridgewell/trace-mapping";

const MAX_MAP_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_BYTES = 96 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 64;
const CACHE_TTL_MS = 5 * 60 * 1000;

const MAX_SEGMENTS = 1_000_000;
const MAX_REQUEST_DECODE_BYTES = 128 * 1024 * 1024;
const MAX_REQUEST_MAP_LOADS = 8;

function decodedSize(json) {
  if (
    typeof json.mappings !== "string" ||
    !Array.isArray(json.sources) ||
    !Array.isArray(json.names)
  )
    return;
  let segments = 0;
  let lines = 1;
  let start = true;
  for (let index = 0; index < json.mappings.length; index++) {
    const code = json.mappings.charCodeAt(index);
    if (code === 59) {
      lines++;
      start = true;
    } else if (code === 44) start = true;
    else if (start) {
      if (++segments > MAX_SEGMENTS) return;
      start = false;
    }
  }
  const bytes =
    json.mappings.length * 2 +
    segments * 80 +
    lines * 40 +
    [...json.sources, ...json.names].reduce(
      (sum, value) => sum + 32 + (typeof value === "string" ? value.length * 2 : 0),
      0,
    );
  return bytes <= MAX_CACHE_BYTES ? bytes : undefined;
}
export class SourceMaps {
  entries = new Map();
  bytes = 0;
  hits = 0;
  misses = 0;
  evictions = 0;

  constructor(root) {
    this.root = path.resolve(root);
  }

  prune(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (now - entry.used >= CACHE_TTL_MS) this.remove(key);
    }
  }

  remove(key) {
    this.bytes -= this.entries.get(key).bytes;
    this.entries.delete(key);
    this.evictions++;
  }

  get(release, filename, work = { loads: 0, readBytes: 0, decodedBytes: 0 }) {
    const key = `${release}/${filename.slice("app:///".length)}.map`;
    const file = path.join(this.root, key);
    const cached = this.entries.get(key);
    this.misses++;
    if (!cached && work.loads >= MAX_REQUEST_MAP_LOADS) return;
    if (!cached) work.loads++;
    try {
      const stat = statSync(file);
      if (!stat.isFile() || stat.size > MAX_MAP_BYTES || realpathSync(file) !== file) return;
      if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) {
        cached.used = Date.now();
        this.entries.delete(key);
        this.entries.set(key, cached);
        this.hits++;
        this.misses--;
        return cached.map;
      }
      if (cached) {
        this.remove(key);
        if (work.loads >= MAX_REQUEST_MAP_LOADS) return;
        work.loads++;
      }
      if (work.readBytes + stat.size > MAX_MAP_BYTES) return;
      work.readBytes += stat.size;
      const manifest = JSON.parse(
        readFileSync(path.join(this.root, release, "manifest.json"), "utf8"),
      );
      const relative = key.slice(release.length + 1);
      if (manifest.buildId !== release || !Object.hasOwn(manifest.maps, relative)) return;
      const content = readFileSync(file);
      if (createHash("sha256").update(content).digest("hex") !== manifest.maps[relative]) return;
      const json = JSON.parse(content.toString("utf8"));
      delete json.sourcesContent;
      const bytes = decodedSize(json);
      if (bytes === undefined || work.decodedBytes + bytes > MAX_REQUEST_DECODE_BYTES) return;
      work.decodedBytes += bytes;
      while (this.entries.size >= MAX_CACHE_ENTRIES || this.bytes + bytes > MAX_CACHE_BYTES) {
        this.remove(this.entries.keys().next().value);
      }
      const map = new TraceMap(json);
      decodedMappings(map);
      this.entries.set(key, { map, bytes, size: stat.size, mtime: stat.mtimeMs, used: Date.now() });
      this.bytes += bytes;
      return map;
    } catch {
      return undefined;
    }
  }

  frame(release, frame, request) {
    const key = `${frame.filename}:${frame.lineno}:${frame.colno}`;
    if (request.frames.has(key)) return request.frames.get(key) ?? frame;
    request.frames.set(key, undefined);
    if (!frame.lineno || request.failed.has(frame.filename)) return frame;
    const map = this.get(release, frame.filename, request.work);
    if (!map) {
      request.failed.add(frame.filename);
      return frame;
    }
    try {
      const original = originalPositionFor(map, {
        line: frame.lineno,
        column: Math.max(0, (frame.colno ?? 1) - 1),
      });
      if (!original.source || original.line === null) return frame;
      const normalized = original.source.replaceAll("\\", "/");
      const source = normalized.match(/(?:^|\/)((?:src|packages|node_modules)\/[^?#\n\r]+)$/)?.[1];
      const resolved = {
        filename: (source ?? path.posix.basename(normalized)).slice(0, 256),
        function: (original.name ?? "?").slice(0, 128),
        lineno: original.line,
        colno: original.column + 1,
      };
      request.frames.set(key, resolved);
      return resolved;
    } catch {
      return frame;
    }
  }
}

// Extracts protocol types from the generated ts-rs bindings + the Rust source
// and writes a JSON the docs' <ProtocolType> component renders as TypeScript /
// Rust tabs with a "References" line linking nested types.
//
// Run: node scripts/gen-protocol-doc-types.mjs   (after `yarn gen:protocol`)
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TS_DIR = join(root, "src/protocol");
const RUST_DIR = join(root, "manabrew-rs/crates/manabrew-protocol/src");
const OUT = join(root, "website/src/generated/protocol-types.json");

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

function walk(dir, ext) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (e.endsWith(ext)) out.push(p);
  }
  return out;
}

// name -> raw TS type body, across all generated bindings.
const tsBody = {};
for (const f of walk(TS_DIR, ".ts")) {
  for (const m of readFileSync(f, "utf8").matchAll(/export type (\w+) = ([^;]*);/g)) {
    tsBody[m[1]] = m[2].trim();
  }
}
const known = new Set(Object.keys(tsBody));

// name -> Rust `struct`/`enum` text. Keeps `#[serde(...)]` (struct-, enum- and
// field-level) and doc comments, drops `#[derive]`/`#[ts]` noise. The serde
// attributes are exactly what map the snake_case Rust onto the camelCase wire
// shape shown in the TypeScript tab — there is one protocol (the wire).
const isNoise = (l) => /^\s*#\[(derive|ts)\b/.test(l);
const bracketDelta = (l) => {
  let d = 0;
  for (const ch of l) {
    if (ch === "[" || ch === "(") d++;
    else if (ch === "]" || ch === ")") d--;
  }
  return d;
};
const rustText = {};
for (const f of walk(RUST_DIR, ".rs")) {
  const lines = readFileSync(f, "utf8").split("\n");
  let attrs = [];
  let attrDepth = 0; // open brackets inside a multi-line attribute
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (attrDepth > 0) {
      attrs.push(line);
      attrDepth += bracketDelta(line);
      continue;
    }
    const m = line.match(/^pub (?:struct|enum) (\w+)\b/);
    if (m) {
      const body = [];
      let depth = 0,
        started = false,
        end = i;
      for (let j = i; j < lines.length; j++) {
        if (!isNoise(lines[j])) body.push(lines[j]);
        for (const ch of lines[j]) {
          if (ch === "{") {
            depth++;
            started = true;
          } else if (ch === "}") depth--;
        }
        end = j;
        if (started && depth === 0) break;
      }
      rustText[m[1]] = [...attrs.filter((a) => !isNoise(a)), ...body].join("\n");
      attrs = [];
      i = end;
      continue;
    }
    const t = line.trim();
    if (t.startsWith("#[")) {
      attrs.push(line);
      attrDepth = bracketDelta(line);
    } else if (t.startsWith("//")) {
      attrs.push(line);
    } else {
      attrs = [];
    }
  }
}

// A single object literal `{ … }` with nothing after the closing brace can be an
// interface; unions/intersections/aliases stay as `type X = …`.
function isPureObject(body) {
  if (body[0] !== "{") return false;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth === 0) return i === body.length - 1;
  }
  return false;
}

async function fmtTs(name, body) {
  const code = isPureObject(body) ? `interface ${name} ${body}` : `type ${name} = ${body};`;
  const fmt = (c) => prettier.format(c, { parser: "typescript", printWidth: 80 });
  try {
    return (await fmt(code)).trim();
  } catch {
    return (await fmt(`type ${name} = ${body};`)).trim();
  }
}

// Named protocol types referenced inside a type body (comments stripped).
function rawRefs(name, body) {
  const found = new Set(body.replace(/\/\*[\s\S]*?\*\//g, "").match(/\b[A-Z][A-Za-z0-9]*\b/g) ?? []);
  return [...found].filter((t) => t !== name && known.has(t));
}

// The "shared" supporting types are derived, not hand-listed: the transitive
// closure of every type the prompt *arguments* (the *Input types) reference,
// minus the prompt messages themselves. Adding a prompt that references a new
// DTO grows this automatically; a response-only type (e.g. ManaSourceAction)
// stays off it.
const SHARED = (() => {
  const out = new Set();
  const queue = Object.keys(tsBody)
    .filter((n) => /Input$/.test(n) && n !== "PromptInput")
    .flatMap((n) => rawRefs(n, tsBody[n]));
  while (queue.length) {
    const t = queue.pop();
    if (out.has(t) || /Input$|Output$/.test(t)) continue;
    out.add(t);
    queue.push(...rawRefs(t, tsBody[t]));
  }
  return [...out].sort();
})();

function refsOf(name, body) {
  return rawRefs(name, body)
    .filter((t) => SHARED.includes(t))
    .sort();
}

const types = {};
async function emit(name) {
  if (types[name] || !tsBody[name]) return;
  types[name] = {
    ts: await fmtTs(name, tsBody[name]),
    rust: rustText[name] ?? null,
    refs: refsOf(name, tsBody[name]),
  };
}

const prompts = {};
for (const name of Object.keys(tsBody)) {
  if (!/Input$/.test(name) || name === "PromptInput") continue;
  prompts[kebab(name.replace(/Input$/, ""))] = name;
  await emit(name);
}
for (const name of SHARED) await emit(name);

const sortKeys = (o) =>
  Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify({ prompts: sortKeys(prompts), shared: SHARED, types: sortKeys(types) });
writeFileSync(OUT, await prettier.format(json, { parser: "json", filepath: OUT }));
console.log(`wrote ${Object.keys(types).length} types (${Object.keys(prompts).length} prompts) -> ${OUT}`);

// Fails when a protocol docs page contradicts the source it describes. The
// pages built and read fine while claiming "v1" against a 5.2.0 crate and
// while tabling nine relay envelope kinds out of eleven (#777); nothing else
// can catch prose being wrong. Only machine-readable claims are checked.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const failures = [];
const fail = (file, message) => failures.push({ file, message });
const sorted = (s) => [...s].sort().join(", ") || "(none)";

const SERVER_TYPES = "src/types/server.ts";
const INDEX_DOC = "website/src/content/docs/protocol/index.mdx";
const TRANSPORT_DOC = "website/src/content/docs/protocol/transport.mdx";
const PROTOCOL_MANIFEST = "manabrew-rs/crates/manabrew-protocol/Cargo.toml";
const RELAY_MANIFEST = "manabrew-rs/crates/manabrew-relay-protocol/Cargo.toml";

const crateVersion = (manifest) => read(manifest).match(/^version\s*=\s*"([^"]+)"/m)?.[1];

// A declaration up to the next blank line. Stopping at the first `;` truncates
// the union mid-way: its members carry semicolons of their own.
function declaration(source, needle) {
  const start = source.indexOf(needle);
  if (start === -1) return null;
  const end = source.indexOf("\n\n", start);
  return source.slice(start, end === -1 ? undefined : end);
}

function envelopeKinds(source) {
  const union = declaration(source, "export type StateEnvelope =");
  if (!union) return null;
  const kinds = new Set([...union.matchAll(/kind:\s*"([^"]+)"/g)].map((m) => m[1]));

  for (const [, name] of union.matchAll(/\|\s*(\w+Envelope)\b/g)) {
    const referenced = declaration(source, `interface ${name}`) ?? "";
    for (const [, literal] of referenced.matchAll(/kind:\s*"([^"]+)"/g)) kinds.add(literal);
    // Members can name a `const` instead of inlining the literal.
    for (const [, constant] of referenced.matchAll(/kind:\s*typeof\s+(\w+)/g)) {
      const value = source.match(new RegExp(`${constant}\\s*=\\s*"([^"]+)"`))?.[1];
      if (value) kinds.add(value);
      else fail(SERVER_TYPES, `could not resolve ${constant} for ${name}`);
    }
  }
  return kinds;
}

function documentedKinds() {
  const doc = read(TRANSPORT_DOC);
  const table = doc.slice(doc.indexOf("| `kind`"));
  return new Set(
    [...table.matchAll(/^\|\s*`([a-zA-Z]+)`\s*\|/gm)].map((m) => m[1]).filter((k) => k !== "kind"),
  );
}

const implemented = envelopeKinds(read(SERVER_TYPES));
if (!implemented || implemented.size === 0) {
  fail(SERVER_TYPES, "found no `StateEnvelope` kinds — this check needs updating");
} else {
  const documented = documentedKinds();
  const missing = [...implemented].filter((k) => !documented.has(k)).sort();
  const extra = [...documented].filter((k) => !implemented.has(k)).sort();
  if (missing.length || extra.length) {
    fail(
      TRANSPORT_DOC,
      [
        `the envelope table disagrees with StateEnvelope in ${SERVER_TYPES}`,
        missing.length ? `undocumented: ${missing.join(", ")}` : null,
        extra.length ? `documented but not implemented: ${extra.join(", ")}` : null,
        `documented:  ${sorted(documented)}`,
        `implemented: ${sorted(implemented)}`,
      ]
        .filter(Boolean)
        .join("\n    "),
    );
  }
}

const crates = {
  "manabrew-protocol": crateVersion(PROTOCOL_MANIFEST),
  "manabrew-relay-protocol": crateVersion(RELAY_MANIFEST),
};
for (const [name, version] of Object.entries(crates)) {
  if (!version) fail(name, "could not read a version from its Cargo.toml");
}

// Longest first: "manabrew-relay-protocol" also ends in "protocol".
const names = Object.keys(crates).sort((a, b) => b.length - a.length);
const pinned = new RegExp(`\\b(${names.join("|")})\\b[^\\n]{0,24}?(\\d+\\.\\d+\\.\\d+)`, "g");

for (const file of [
  INDEX_DOC,
  TRANSPORT_DOC,
  "website/src/content/docs/protocol/conformance.mdx",
  "packages/protocol/README.md",
]) {
  for (const [, crate, claimed] of read(file).matchAll(pinned)) {
    if (crates[crate] && claimed !== crates[crate]) {
      fail(file, `claims ${crate} ${claimed}, but that crate is ${crates[crate]}`);
    }
  }
}

// PROTOCOL_VERSION is the relay crate's major, not the protocol crate's.
const relayMajor = crates["manabrew-relay-protocol"]?.split(".")[0];
for (const [, claimed] of read(INDEX_DOC).matchAll(/`?PROTOCOL_VERSION`?\s+is\s+(\d+)\b/g)) {
  if (claimed !== relayMajor) {
    fail(INDEX_DOC, `says PROTOCOL_VERSION is ${claimed}; the relay crate major is ${relayMajor}`);
  }
}

if (failures.length) {
  console.error("Protocol docs have drifted from the source:\n");
  for (const { file, message } of failures) console.error(`  ${file}\n    ${message}\n`);
  console.error("Update the docs, or this script if the source moved on purpose.");
  process.exit(1);
}

console.log(`Protocol docs match the source (${implemented?.size ?? 0} envelope kinds).`);

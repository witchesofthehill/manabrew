// Fails when a protocol docs page contradicts the source it describes. The
// pages built and read fine while claiming "v1" against a 5.2.0 crate (#777);
// nothing else can catch prose being wrong. Only machine-readable claims are
// checked.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const failures = [];
const fail = (file, message) => failures.push({ file, message });

const INDEX_DOC = "website/src/content/docs/protocol/index.mdx";
const PROTOCOL_MANIFEST = "manabrew-rs/crates/manabrew-protocol/Cargo.toml";
const RELAY_MANIFEST = "manabrew-rs/crates/manabrew-relay-protocol/Cargo.toml";

const crateVersion = (manifest) => read(manifest).match(/^version\s*=\s*"([^"]+)"/m)?.[1];

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

for (const file of [INDEX_DOC, "packages/protocol/README.md"]) {
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

console.log("Protocol docs match the source.");

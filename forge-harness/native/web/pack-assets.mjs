// Packs the Forge asset tree the harness needs into one NUL-framed text file:
// "path\0body\0path\0body...". Everything Forge reads on this path is text, so
// staying out of binary lets the browser decode it as ordinary UTF-8 and lets
// java.util.zip stay unused (it does not exist under Web Image).
//
//   node pack-assets.mjs <forge-gui-dir> <parity-decks-dir> <out.txt>
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [, , forgeGui, out, ...deckDirs] = process.argv;
if (!out || !deckDirs.length) {
  console.error("usage: node pack-assets.mjs <forge-gui-dir> <out.txt> <deck-dir...>");
  process.exit(1);
}

// FModel.initialize insists on all of these. Dropping `lists` changes card
// legality and breaks parity, so it stays even though it is 4MB of the total.
const NEEDED = ["editions", "tokenscripts", "lists", "formats", "blockdata", "defaults", "effects"];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const chunks = [];
let files = 0,
  skipped = 0;
const add = (full, rel) => {
  const body = readFileSync(full, "utf8");
  if (body.includes("\0")) {
    skipped++;
    return;
  }
  chunks.push(rel, "\0", body, "\0");
  files++;
};

for (const dir of NEEDED) {
  for (const full of walk(join(forgeGui, "res", dir))) {
    add(full, "res/" + relative(join(forgeGui, "res"), full));
  }
}
for (const dir of deckDirs) {
  for (const full of walk(dir)) add(full, "parity_decks/" + relative(dir, full));
}

// Only the cards the decks actually reference. Forge reads the whole
// cardsfolder at init, so shipping 33,645 scripts is possible but pointless.
// Forge files are ASCII: strip diacritics, drop punctuation, underscore the rest.
const slug = (n) =>
  n
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['",.]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
const names = new Set();
for (const dir of deckDirs) {
  for (const full of walk(dir)) {
    if (!full.endsWith(".json")) continue;
    let doc;
    try {
      doc = JSON.parse(readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    for (const card of doc.cards || []) if (card && card.name) names.add(card.name);
  }
}
let missing = 0;
const missingNames = [];
for (const name of names) {
  const s = slug(name);
  const rel = `res/cardsfolder/${s[0]}/${s}.txt`;
  try {
    add(join(forgeGui, rel), rel);
  } catch {
    // Double-faced scripts are filed under "front_back"; find by prefix.
    const dir = join(forgeGui, "res/cardsfolder", s[0]);
    let found = null;
    try {
      found = readdirSync(dir).find((f) => f.startsWith(s + "_") && f.endsWith(".txt"));
    } catch {
      /* letter dir absent */
    }
    if (found) {
      add(join(dir, found), `res/cardsfolder/${s[0]}/${found}`);
    } else {
      missing++;
      missingNames.push(name);
    }
  }
}

writeFileSync(out, chunks.join(""));
console.log(
  `packed ${files} files, ${names.size} deck cards (${skipped} binary skipped, ${missing} missing)`,
);
if (missingNames.length) console.error("missing:", missingNames.slice(0, 12).join(", "));

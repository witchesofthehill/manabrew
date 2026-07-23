#!/usr/bin/env node
/**
 * Audit every preset deck against Scryfall. For each (name, set) pair we
 * POST to /cards/collection (batched 75 at a time, the API max). Any pair
 * Scryfall rejects gets re-queried by name only to discover a valid
 * printing; the deck file is rewritten with the new set code.
 *
 * Usage:
 *   node scripts/audit-preset-decks.mjs            # report only
 *   node scripts/audit-preset-decks.mjs --apply    # also patch the deck files
 *
 * Scryfall is rate-limited at ~10 req/s; we sleep 100ms between calls.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DECKS_DIR = path.join(__dirname, "..", "public/preset_decks");
const APPLY = process.argv.includes("--apply");
// Scryfall asks for ≤ 10 req/s and recommends ≥ 50–100ms between calls.
// 500ms is very generous and survives back-to-back script invocations
// without re-tripping the throttle (Scryfall keeps rolling counters).
const SCRYFALL_DELAY_MS = 500;
const BATCH_SIZE = 75;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) {
  console.log(...args);
}

/** Read every preset deck and return [{ file, json, cards }]. */
function loadDecks() {
  const files = fs
    .readdirSync(DECKS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => path.join(DECKS_DIR, f));
  return files.map((file) => {
    const raw = fs.readFileSync(file, "utf8");
    const json = JSON.parse(raw);
    return { file, json };
  });
}

/** Group identifiers across decks. Same (name, set) appearing in multiple
 *  decks is queried once. */
function collectIdentifiers(decks) {
  const seen = new Map(); // key=`${name}|${set}` -> { name, set, occurrences: [{deckFile, cardIndex}] }
  for (const { file, json } of decks) {
    const cards = json.cards ?? [];
    cards.forEach((card, idx) => {
      const name = card.name?.trim();
      const set = (card.set ?? "").trim().toLowerCase();
      if (!name) return;
      const key = `${name}|${set}`;
      if (!seen.has(key)) seen.set(key, { name, set, occurrences: [] });
      seen.get(key).occurrences.push({ file, idx });
    });
  }
  return [...seen.values()];
}

async function postCollection(identifiers) {
  const body = JSON.stringify({
    identifiers: identifiers.map((id) =>
      id.set ? { name: id.name, set: id.set } : { name: id.name },
    ),
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
    });
    if (res.status === 429) {
      // Scryfall enforces the throttle aggressively — back off a full
      // minute on the first hit, then increase.
      const wait = 60_000 * (attempt + 1);
      process.stderr.write(`  rate-limited, waiting ${wait / 1000}s...\n`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Scryfall /collection failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }
  throw new Error("Scryfall /collection rate-limited after retries");
}

async function lookupByName(name) {
  // Try `exact=` first (avoids fuzzy ambiguity), then fall back to fuzzy.
  // Retry once on 429. Returns either a Scryfall card object or null with
  // an error string explaining why.
  const tryOnce = async (url) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await fetch(url);
      if (res.status === 429) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.object === "card") return { card: body };
      return { error: `${res.status} ${body.details ?? body.code ?? ""}`.trim() };
    }
    return { error: "rate-limited after retries" };
  };

  const exact = await tryOnce(
    `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`,
  );
  if (exact.card) return exact.card;
  await sleep(SCRYFALL_DELAY_MS);
  const fuzzy = await tryOnce(
    `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,
  );
  if (fuzzy.card) return fuzzy.card;
  return { _error: fuzzy.error || exact.error || "unknown" };
}

(async () => {
  const decks = loadDecks();
  log(`Loaded ${decks.length} preset deck files.`);

  // Skip cards with no set code at all — nothing to validate.
  const all = collectIdentifiers(decks);
  const withSet = all.filter((id) => id.set);
  log(`Total card entries: ${all.length} (${all.length - withSet.length} have no set, will skip).`);
  log(`Unique (name, set) pairs to verify: ${withSet.length}`);

  // Scryfall's /collection rejects set codes outside 3–6 chars with
  // HTTP 400 ("A `set` identifier must be between 3-6 characters") —
  // pre-flag those as broken instead of letting the batch crash.
  const wellFormed = [];
  const broken = []; // { name, set, occurrences }
  for (const id of withSet) {
    if (id.set.length < 3 || id.set.length > 6) broken.push(id);
    else wellFormed.push(id);
  }
  if (broken.length > 0) {
    log(`  pre-flagged ${broken.length} pair(s) with malformed set codes`);
  }

  for (let i = 0; i < wellFormed.length; i += BATCH_SIZE) {
    const chunk = wellFormed.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  batch ${i / BATCH_SIZE + 1} (${chunk.length} cards)... `);
    const result = await postCollection(chunk);
    const notFound = result.not_found ?? [];
    process.stdout.write(`${notFound.length} broken\n`);
    for (const nf of notFound) {
      const entry = wellFormed.find((id) => id.name === nf.name && id.set === nf.set);
      if (entry) broken.push(entry);
    }
    await sleep(SCRYFALL_DELAY_MS);
  }

  log(`\nBroken pairs: ${broken.length}\n`);
  if (broken.length === 0) {
    log("All preset deck (name, set) pairs verified by Scryfall. Nothing to fix.");
    return;
  }

  const fixes = []; // { name, oldSet, newSet, occurrences }
  for (const { name, set, occurrences } of broken) {
    process.stdout.write(`  resolving "${name}" (was ${set})... `);
    const card = await lookupByName(name);
    await sleep(SCRYFALL_DELAY_MS);
    if (!card || card._error || !card.set) {
      console.log(`NOT FOUND (${card?._error ?? "no result"}) — leaving as-is`);
      continue;
    }
    const newSet = card.set;
    console.log(`-> ${newSet}`);
    fixes.push({ name, oldSet: set, newSet, occurrences });
  }

  log(`\nResolved ${fixes.length}/${broken.length} broken pairs.\n`);

  // Group fixes by deck file for the report.
  const byDeck = new Map();
  for (const fix of fixes) {
    for (const occ of fix.occurrences) {
      if (!byDeck.has(occ.file)) byDeck.set(occ.file, []);
      byDeck.get(occ.file).push({ ...fix, idx: occ.idx });
    }
  }
  for (const [file, entries] of byDeck) {
    log(path.basename(file));
    for (const e of entries) {
      log(`  ${e.name}: ${e.oldSet} -> ${e.newSet}`);
    }
  }

  if (!APPLY) {
    log(`\nDry run — pass --apply to rewrite the deck files.`);
    return;
  }

  for (const { file, json } of decks) {
    const entries = byDeck.get(file);
    if (!entries) continue;
    const cards = json.cards ?? [];
    let mutated = false;
    for (const entry of entries) {
      const card = cards[entry.idx];
      if (!card) continue;
      if ((card.set ?? "").toLowerCase() !== entry.oldSet) continue;
      card.set = entry.newSet;
      mutated = true;
    }
    if (mutated) {
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
      log(`  wrote ${path.basename(file)}`);
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

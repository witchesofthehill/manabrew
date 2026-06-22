#!/usr/bin/env node
/**
 * Bakes Scryfall metadata into each preset deck JSON so the runtime
 * doesn't need to enrich cards via the API at startup.
 *
 * Idempotent — re-running only fetches cards whose JSON entries are
 * missing metadata fields. Pass `--force` to re-fetch everything.
 *
 * Usage:
 *   node scripts/enrich-preset-decks.mjs [--force]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DECKS_DIR = path.join(__dirname, "..", "public/preset_decks");
const SCRYFALL_API = "https://api.scryfall.com";
const COLLECTION_BATCH_SIZE = 75;
const FORCE = process.argv.includes("--force");

const META_FIELDS = [
  "manaCost",
  "colors",
  "colorIdentity",
  "types",
  "subtypes",
  "supertypes",
  "text",
  "cmc",
  "layout",
  "power",
  "toughness",
  "imageUrl",
];

function hasMetadata(entry) {
  return META_FIELDS.some((f) => f in entry);
}

function isFullyEnriched(entry) {
  return hasMetadata(entry) && "allParts" in entry;
}

function parseTypeLine(typeLine) {
  if (!typeLine) return { supertypes: [], types: [], subtypes: [] };
  const [main, ...subParts] = typeLine.split("—").map((s) => s.trim());
  const subtypes = subParts.length > 0 ? subParts.join(" ").split(/\s+/).filter(Boolean) : [];
  const tokens = main.split(/\s+/).filter(Boolean);
  const SUPER = new Set([
    "Basic",
    "Legendary",
    "Snow",
    "World",
    "Ongoing",
    "Tribal",
    "Elite",
    "Host",
    "Token",
  ]);
  const supertypes = [];
  const types = [];
  for (const t of tokens) {
    if (SUPER.has(t)) supertypes.push(t);
    else types.push(t);
  }
  return { supertypes, types, subtypes };
}

function frontFace(sc) {
  return sc.card_faces?.[0] ?? sc;
}

function metadataFromScryfall(sc) {
  const front = frontFace(sc);
  const tl = front.type_line ?? sc.type_line ?? "";
  const { supertypes, types, subtypes } = parseTypeLine(tl);
  return {
    manaCost: front.mana_cost ?? sc.mana_cost ?? "",
    colors: sc.colors ?? front.colors ?? [],
    colorIdentity: sc.color_identity ?? [],
    cmc: sc.cmc ?? 0,
    types,
    subtypes,
    supertypes,
    text: front.oracle_text ?? sc.oracle_text ?? "",
    imageUrl: front.image_uris?.normal ?? sc.image_uris?.normal ?? "",
    layout: sc.layout ?? "normal",
    power: front.power ?? sc.power,
    toughness: front.toughness ?? sc.toughness,
    allParts: Array.isArray(sc.all_parts)
      ? sc.all_parts.map((p) => ({ name: p.name, component: p.component }))
      : [],
  };
}

async function fetchBatch(identifiers) {
  const res = await fetch(`${SCRYFALL_API}/cards/collection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers }),
  });
  if (!res.ok) throw new Error(`Scryfall ${res.status}`);
  return res.json();
}

async function main() {
  const files = fs
    .readdirSync(DECKS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .sort();

  // Step 1: collect every (name, set) printing that needs fetching.
  const needed = new Map();
  const fileData = [];
  for (const f of files) {
    const p = path.join(DECKS_DIR, f);
    const json = JSON.parse(fs.readFileSync(p, "utf-8"));
    fileData.push({ file: f, path: p, json });
    for (const card of json.cards || []) {
      if (!FORCE && isFullyEnriched(card)) continue;
      const set = card.set?.toLowerCase();
      const cn = card.cardNumber?.toLowerCase();
      const key = `${card.name.toLowerCase()}::${set ?? ""}::${cn ?? ""}`;
      if (!needed.has(key)) {
        // Scryfall's /cards/collection name lookup matches a single face;
        // strip the back-face half of DFC display names so the lookup hits.
        const lookupName = card.name.includes("//")
          ? card.name.split(/\s*\/\/\s*/)[0].trim()
          : card.name;
        const id =
          set && cn
            ? { set, collector_number: cn }
            : set
              ? { name: lookupName, set }
              : { name: lookupName };
        needed.set(key, { card, id });
      }
    }
  }

  console.log(`[enrich] ${files.length} preset decks; ${needed.size} unique printings to fetch`);
  if (needed.size === 0) {
    console.log("[enrich] all cards already enriched, exiting");
    return;
  }

  // Step 2: batch-fetch missing printings.
  const lookup = new Map();
  const items = [...needed.entries()];
  for (let i = 0; i < items.length; i += COLLECTION_BATCH_SIZE) {
    const slice = items.slice(i, i + COLLECTION_BATCH_SIZE);
    const ids = slice.map(([, v]) => v.id);
    process.stdout.write(
      `[enrich] batch ${i / COLLECTION_BATCH_SIZE + 1}/${Math.ceil(items.length / COLLECTION_BATCH_SIZE)}…\r`,
    );
    let data;
    try {
      data = await fetchBatch(ids);
    } catch (err) {
      console.error(`\n[enrich] batch failed:`, err.message);
      continue;
    }
    for (const sc of data.data) {
      const meta = metadataFromScryfall(sc);
      const setLow = sc.set.toLowerCase();
      const cnLow = sc.collector_number.toLowerCase();
      const nameLow = sc.name.toLowerCase();
      // Most-specific key first so set+cn lookups always hit the exact print.
      lookup.set(`${nameLow}::${setLow}::${cnLow}`, meta);
      lookup.set(`${nameLow}::${setLow}::`, meta);
      const nameOnly = `${nameLow}::::`;
      if (!lookup.has(nameOnly)) lookup.set(nameOnly, meta);
      // Match each face for split / DFC names.
      for (const face of sc.card_faces ?? []) {
        const faceKey = `${face.name.toLowerCase()}::::`;
        if (!lookup.has(faceKey)) lookup.set(faceKey, meta);
      }
    }
    if (data.not_found?.length) {
      for (const nf of data.not_found) {
        console.warn(`\n[enrich] not found: ${nf.name ?? JSON.stringify(nf)}`);
      }
    }
    // be polite — Scryfall asks for ~50-100ms between requests
    await new Promise((r) => setTimeout(r, 100));
  }
  process.stdout.write("\n");

  // Step 3: rewrite JSONs with metadata merged into each card entry.
  let writtenFiles = 0;
  let writtenCards = 0;
  for (const { file, path: p, json } of fileData) {
    let touched = false;
    json.cards = (json.cards ?? []).map((card) => {
      if (!FORCE && isFullyEnriched(card)) return card;
      const nameLow = card.name.toLowerCase();
      const setLow = (card.set ?? "").toLowerCase();
      const cnLow = (card.cardNumber ?? "").toLowerCase();
      const meta =
        lookup.get(`${nameLow}::${setLow}::${cnLow}`) ??
        lookup.get(`${nameLow}::${setLow}::`) ??
        lookup.get(`${nameLow}::::`);
      if (!meta) return card;
      touched = true;
      writtenCards++;
      // Already partially enriched (e.g. via import-deck.ts which writes `uris`):
      // preserve the existing shape and only patch in `allParts` so we don't
      // churn unrelated fields or drop the full `uris` object.
      if (hasMetadata(card)) {
        return { ...card, allParts: meta.allParts ?? [] };
      }
      const ordered = { name: card.name };
      if (card.count !== undefined) ordered.count = card.count;
      if (card.set !== undefined) ordered.set = card.set;
      if (card.cardNumber !== undefined) ordered.cardNumber = card.cardNumber;
      Object.assign(ordered, meta);
      return ordered;
    });
    if (touched) {
      fs.writeFileSync(p, JSON.stringify(json, null, 2) + "\n");
      writtenFiles++;
      console.log(`[enrich] wrote ${file}`);
    }
  }
  console.log(`[enrich] enriched ${writtenCards} card entries across ${writtenFiles} files`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

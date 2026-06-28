#!/usr/bin/env node

import fs from "fs";
import path from "path";

const SCRYFALL_API = "https://api.scryfall.com";
const DEFAULT_OUT = "public/token_archive.json";
const TOKEN_SEARCH_QUERY = "include:extras type:token";

const MTG_SUPERTYPES = new Set(["Basic", "Legendary", "Snow", "World", "Ongoing", "Token"]);

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function parseTypeLine(typeLine) {
  const [mainPart = "", subPart = ""] = String(typeLine)
    .split("—")
    .map((s) => s.trim());
  const mainTokens = mainPart.split(/\s+/).filter(Boolean);
  return {
    supertypes: mainTokens.filter((t) => MTG_SUPERTYPES.has(t)),
    types: mainTokens.filter((t) => !MTG_SUPERTYPES.has(t)),
    subtypes: subPart ? subPart.split(/\s+/).filter(Boolean) : [],
  };
}

function frontFace(card) {
  return card.card_faces?.[0] ?? card;
}

function imageUris(card) {
  const face = frontFace(card);
  return face.image_uris ?? card.image_uris ?? null;
}

function deckCardFromScryfallToken(card) {
  const face = frontFace(card);
  const uris = imageUris(card);
  if (!uris) throw new Error(`token has no image_uris: ${card.name} (${card.id})`);

  const typeLine = face.type_line ?? card.type_line ?? "";
  const { supertypes, types, subtypes } = parseTypeLine(typeLine);
  const colors = card.colors ?? face.colors ?? [];

  return {
    identity: {
      id: `token:${card.id}`,
      name: card.name,
      setCode: card.set,
      cardNumber: card.collector_number,
      foil: false,
    },
    color: colors.join(""),
    colorIdentity: card.color_identity ?? [],
    manaCost: face.mana_cost ?? card.mana_cost ?? "",
    cmc: card.cmc ?? 0,
    types,
    subtypes,
    supertypes,
    power: face.power ?? card.power,
    toughness: face.toughness ?? card.toughness,
    text: face.oracle_text ?? card.oracle_text ?? "",
    uris,
    isDoubleFaced: card.layout === "double_faced_token" || undefined,
    layout: card.layout || undefined,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchTokenCards() {
  const cards = [];
  let page = `${SCRYFALL_API}/cards/search?unique=prints&order=name&q=${encodeURIComponent(
    TOKEN_SEARCH_QUERY,
  )}`;

  while (page) {
    console.error(`[tokens] fetching ${page}`);
    const body = await fetchJson(page);
    cards.push(...body.data);
    page = body.has_more ? body.next_page : null;
  }

  return cards;
}

function buildArchive(cards) {
  const tokens = cards.map(deckCardFromScryfallToken).sort((a, b) => {
    const nameCmp = a.identity.name.localeCompare(b.identity.name);
    if (nameCmp !== 0) return nameCmp;
    const setCmp = String(a.identity.setCode).localeCompare(String(b.identity.setCode));
    if (setCmp !== 0) return setCmp;
    return String(a.identity.cardNumber).localeCompare(String(b.identity.cardNumber), undefined, {
      numeric: true,
    });
  });

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    source: {
      type: "scryfall-search",
      query: TOKEN_SEARCH_QUERY,
      uri: `${SCRYFALL_API}/cards/search`,
    },
    counts: {
      scryfallTokenCandidates: cards.length,
      tokens: tokens.length,
    },
    tokens,
  };
}

async function main() {
  const outPath = path.resolve(process.cwd(), argValue("--out", DEFAULT_OUT));
  const cards = await fetchTokenCards();
  const archive = buildArchive(cards);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(archive, null, 2)}\n`);

  console.error(
    `[tokens] wrote ${archive.counts.tokens} tokens from ${archive.counts.scryfallTokenCandidates} candidates to ${path.relative(process.cwd(), outPath)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

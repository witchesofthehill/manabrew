#!/usr/bin/env node

import fs from "fs";
import path from "path";

const SCRYFALL_API = "https://api.scryfall.com";
const DEFAULT_OUT = "public/token_archive.json";
const TOKEN_SEARCH_QUERY = "include:extras type:token";
const FORGE_CARDS_DIR = "forge/forge-gui/res/cardsfolder";
const FORGE_EDITIONS_DIR = "forge/forge-gui/res/editions";

const MTG_SUPERTYPES = new Set(["Basic", "Legendary", "Snow", "World", "Ongoing", "Token"]);

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(filePath) : [filePath];
  });
}

function tokenScriptsInLine(line) {
  const colon = line.indexOf(":");
  if (colon <= 0) return [];
  const value = line.slice(colon + 1).trim();
  const tokenIndex = value.indexOf("TokenScript$");
  if (tokenIndex <= 0) return [];
  const tokenParam = value
    .slice(tokenIndex + 12)
    .trim()
    .split("|", 1)[0]
    .trim();
  return tokenParam.split(",");
}

function forgeCardTokenScripts(root) {
  const byCardName = new Map();
  for (const filePath of filesUnder(root).filter((file) => file.endsWith(".txt"))) {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    const name = lines.find((line) => line.startsWith("Name:"))?.slice(5);
    if (!name) continue;
    const scripts = lines.flatMap(tokenScriptsInLine);
    if (scripts.length === 0) continue;
    const key = name.toLowerCase();
    const existing = byCardName.get(key) ?? new Set();
    scripts.forEach((script) => existing.add(script));
    byCardName.set(key, existing);
  }
  return Object.fromEntries(
    [...byCardName.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, scripts]) => [name, [...scripts].sort()]),
  );
}

function forgeEditionTokenScripts(root) {
  const byPrinting = new Map();
  for (const filePath of filesUnder(root).filter((file) => file.endsWith(".txt"))) {
    let section = "";
    let code = "";
    let scryfallCode = "";
    const tokenLines = [];
    for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith("[") && line.endsWith("]")) {
        section = line.toLowerCase();
        continue;
      }
      if (section === "[metadata]") {
        if (line.startsWith("Code=")) code = line.slice(5).toLowerCase();
        if (line.startsWith("ScryfallCode=")) scryfallCode = line.slice(13).toLowerCase();
      } else if (section === "[tokens]" && line && !line.startsWith("#")) {
        tokenLines.push(line);
      }
    }
    const setCode = scryfallCode || code;
    for (const line of tokenLines) {
      const [collectorNumber, tokenScript] = line.split(/\s+/, 3);
      if (!collectorNumber || !tokenScript || !setCode) continue;
      const key = `${setCode}:${collectorNumber.toLowerCase()}`;
      const scripts = byPrinting.get(key) ?? new Set();
      scripts.add(tokenScript);
      byPrinting.set(key, scripts);
    }
  }
  return byPrinting;
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
  const uris = face.image_uris ?? card.image_uris;
  if (!uris) return null;
  return {
    small: uris.small,
    normal: uris.normal,
    large: uris.large,
    png: uris.png,
    art_crop: uris.art_crop,
    border_crop: uris.border_crop,
  };
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
      oracleId: card.oracle_id,
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
      "User-Agent": "Manabrew token archive builder (https://manabrew.app)",
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
  const cardTokenScripts = forgeCardTokenScripts(path.resolve(process.cwd(), FORGE_CARDS_DIR));
  const scriptsByPrinting = forgeEditionTokenScripts(
    path.resolve(process.cwd(), FORGE_EDITIONS_DIR),
  );
  const oracleIdsByScript = new Map();
  const directIdsByScript = new Map();
  for (const card of cards) {
    const setCode = card.set.toLowerCase();
    const collectorNumber = card.collector_number.toLowerCase();
    const directKey = `${setCode}:${collectorNumber}`;
    const forgeKey = setCode.startsWith("t") ? `${setCode.slice(1)}:${collectorNumber}` : directKey;
    const scripts = scriptsByPrinting.get(directKey) ?? scriptsByPrinting.get(forgeKey);
    for (const script of scripts ?? []) {
      const directIds = directIdsByScript.get(script) ?? new Set();
      directIds.add(card.id);
      directIdsByScript.set(script, directIds);
      if (card.oracle_id) {
        const oracleIds = oracleIdsByScript.get(script) ?? new Set();
        oracleIds.add(card.oracle_id);
        oracleIdsByScript.set(script, oracleIds);
      }
    }
  }
  const scriptsByOracleId = new Map();
  for (const [script, oracleIds] of oracleIdsByScript) {
    for (const oracleId of oracleIds) {
      const scripts = scriptsByOracleId.get(oracleId) ?? new Set();
      scripts.add(script);
      scriptsByOracleId.set(oracleId, scripts);
    }
  }
  const printIdsByScript = new Map(directIdsByScript);
  for (const card of cards) {
    for (const script of scriptsByOracleId.get(card.oracle_id) ?? []) {
      const printIds = printIdsByScript.get(script) ?? new Set();
      printIds.add(card.id);
      printIdsByScript.set(script, printIds);
    }
  }
  const tokenScriptPrintIds = Object.fromEntries(
    [...printIdsByScript.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([script, ids]) => [script, [...ids].sort()]),
  );
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
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    source: {
      type: "scryfall-search",
      query: TOKEN_SEARCH_QUERY,
      uri: `${SCRYFALL_API}/cards/search`,
      forgeCards: FORGE_CARDS_DIR,
      forgeEditions: FORGE_EDITIONS_DIR,
    },
    counts: {
      scryfallTokenCandidates: cards.length,
      tokens: tokens.length,
      sourceCardsWithTokenScripts: Object.keys(cardTokenScripts).length,
      tokenScriptsWithPrints: Object.keys(tokenScriptPrintIds).length,
    },
    cardTokenScripts,
    tokenScriptPrintIds,
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

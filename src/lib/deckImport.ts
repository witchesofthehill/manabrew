import {
  fetchArchidektDeck,
  fetchArchidektResult,
  parseArchidektUrl,
  type ArchidektDeck,
  type ArchidektSearchResult,
  type RequestOptions,
} from "./archidekt";
import { fetchMoxfieldDeck, fetchMoxfieldResult, parseMoxfieldUrl } from "./moxfield";
import { BASIC_LAND_NAMES } from "./formats";
import type { DeckFormatId } from "@/types/manabrew";

export type DeckSource = "archidekt" | "moxfield";

export function inferImportedFormat(cardNames: string[]): DeckFormatId {
  if (cardNames.length < 90) return "standard";
  const counts = new Map<string, number>();
  for (const name of cardNames) {
    if (BASIC_LAND_NAMES.has(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.values()].every((n) => n === 1) ? "commander" : "standard";
}

export interface ParsedDeckUrl {
  source: DeckSource;
  id: string;
}

export function parseDeckUrl(input: string): ParsedDeckUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const mox = parseMoxfieldUrl(trimmed);
  if (mox) return { source: "moxfield", id: mox };
  const arc = parseArchidektUrl(trimmed);
  if (arc) return { source: "archidekt", id: arc };
  return null;
}

export interface ParsedDeckEntry {
  name: string;
  count: number;
  side: boolean;
  maybe: boolean;
}

const SIDEBOARD_LINE_REGEX = /^(sideboard|side)\s*:?$/i;
const MAYBEBOARD_LINE_REGEX = /^(maybeboard|maybe)\s*:?$/i;
const MAIN_SECTION_LINE_REGEX = /^(commander|command|mainboard|main|deck|companion)\s*:?$/i;
const DECK_LINE_REGEX = /^(\d+)x?\s+(.+)$/i;
const SET_SUFFIX_REGEX = /\s+\([A-Za-z0-9]{2,6}\)(?:\s+[\w-]+)?(?:\s+\*F\*)?$/i;

export function parseDeckListText(text: string): ParsedDeckEntry[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let section: "main" | "side" | "maybe" = "main";
  const entries: ParsedDeckEntry[] = [];
  for (const line of lines) {
    if (SIDEBOARD_LINE_REGEX.test(line)) {
      section = "side";
      continue;
    }
    if (MAYBEBOARD_LINE_REGEX.test(line)) {
      section = "maybe";
      continue;
    }
    if (MAIN_SECTION_LINE_REGEX.test(line)) {
      section = "main";
      continue;
    }
    const match = line.match(DECK_LINE_REGEX);
    if (!match) continue;
    const name = match[2].trim().replace(SET_SUFFIX_REGEX, "").trim();
    if (!name) continue;
    entries.push({
      count: parseInt(match[1], 10),
      name,
      side: section === "side",
      maybe: section === "maybe",
    });
  }
  return entries;
}

export async function fetchDeckBySource(
  source: DeckSource,
  id: string,
  opts: RequestOptions = {},
): Promise<ArchidektDeck> {
  switch (source) {
    case "archidekt":
      return fetchArchidektDeck(id, opts);
    case "moxfield":
      return fetchMoxfieldDeck(id, opts);
  }
}

export async function fetchResultBySource(
  source: DeckSource,
  id: string,
  opts: RequestOptions = {},
): Promise<ArchidektSearchResult> {
  switch (source) {
    case "archidekt":
      return fetchArchidektResult(id, opts);
    case "moxfield":
      return fetchMoxfieldResult(id, opts);
  }
}

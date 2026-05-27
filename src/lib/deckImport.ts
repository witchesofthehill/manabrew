// Unified deck-source dispatcher. Parses URLs from multiple providers and
// routes fetches to the matching provider-specific module. Both the CLI and
// the in-app importer consume this.

import {
  fetchArchidektDeck,
  fetchArchidektResult,
  parseArchidektUrl,
  type ArchidektDeck,
  type ArchidektSearchResult,
  type RequestOptions,
} from "./archidekt";
import { fetchMoxfieldDeck, fetchMoxfieldResult, parseMoxfieldUrl } from "./moxfield";

export type DeckSource = "archidekt" | "moxfield";

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
}

const SIDEBOARD_LINE_REGEX = /^(sideboard|side)\s*:?$/i;
const DECK_LINE_REGEX = /^(\d+)x?\s+(.+)$/i;
const SET_SUFFIX_REGEX = /\s+\([A-Za-z0-9]{2,6}\)(?:\s+[\w-]+)?(?:\s+\*F\*)?$/i;

export function parseDeckListText(text: string): ParsedDeckEntry[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let inSide = false;
  const entries: ParsedDeckEntry[] = [];
  for (const line of lines) {
    if (SIDEBOARD_LINE_REGEX.test(line)) {
      inSide = true;
      continue;
    }
    const match = line.match(DECK_LINE_REGEX);
    if (!match) continue;
    const name = match[2].trim().replace(SET_SUFFIX_REGEX, "").trim();
    if (!name) continue;
    entries.push({ count: parseInt(match[1], 10), name, side: inSide });
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

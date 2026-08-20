import {
  fetchArchidektDeck,
  fetchArchidektResult,
  parseArchidektUrl,
  type ArchidektDeck,
  type ArchidektSearchResult,
  type RequestOptions,
} from "./archidekt";
import { fetchMoxfieldDeck, fetchMoxfieldResult, parseMoxfieldUrl } from "./moxfield";
import { BASIC_LAND_NAMES, formatRequiresCommander } from "./formats";
import { resolveDeckName } from "./deckName";
import type { DeckCard, DeckFormat } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";

export type DeckSource = "archidekt" | "moxfield";

export function inferImportedFormat(cardNames: string[]): DeckFormat {
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
  commander: boolean;
  setCode?: string;
  collectorNumber?: string;
  foil?: boolean;
}

const SIDEBOARD_LINE_REGEX = /^(sideboard|side)\s*:?$/i;
const MAYBEBOARD_LINE_REGEX = /^(maybeboard|maybe)\s*:?$/i;
const COMMANDER_LINE_REGEX = /^(commander|command)s?\s*:?$/i;
const MAIN_SECTION_LINE_REGEX = /^(mainboard|main|deck|companion)\s*:?$/i;
const DECK_LINE_REGEX = /^(\d+)x?\s+(.+)$/i;
const SET_SUFFIX_REGEX = /\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([\w-]+))?(?:\s+(\*F\*|F))?$/i;
// Archidekt text exports decorate lines with `[Category]` and `^Label,#hex^`
// suffixes; the category is also how they mark the commander.
const LABEL_SUFFIX_REGEX = /\s+\^[^^]*\^$/;
const CATEGORY_SUFFIX_REGEX = /\s+\[([^\]]*)\]$/;
// Deckstats: `//Main` section headers, `[DKM#4] Card` set prefixes, and
// ` #!Commander` (or ` # comment`) line trailers.
const DECKSTATS_SET_PREFIX_REGEX = /^\[[^\]]*\]\s+/;
const COMMENT_SUFFIX_REGEX = /\s+#(.*)$/;
// Headerless exports put the commander in an isolated first or trailing block.
// Only trust that shape for commander-sized lists.
const HEADERLESS_COMMANDER_MIN_MAIN = 90;

export function parseDeckListText(text: string): ParsedDeckEntry[] {
  const lines = text.split("\n").map((l) => l.trim());
  let section: "main" | "side" | "maybe" | "commander" = "main";
  let sawHeader = false;
  let block = 0;
  const blockOf: number[] = [];
  const entries: ParsedDeckEntry[] = [];
  for (const rawLine of lines) {
    if (!rawLine) {
      if (blockOf.length > 0 && blockOf[blockOf.length - 1] === block) block += 1;
      // Exports separate the commander block from the deck with a blank line
      // rather than a "Deck:" heading — without this reset every card below
      // the commander would be flagged as one.
      if (section === "commander") section = "main";
      continue;
    }
    const isComment = rawLine.startsWith("//") && !DECK_LINE_REGEX.test(rawLine);
    const line = isComment ? rawLine.replace(/^\/\/\s*/, "") : rawLine;
    if (SIDEBOARD_LINE_REGEX.test(line)) {
      section = "side";
      sawHeader = true;
      continue;
    }
    if (MAYBEBOARD_LINE_REGEX.test(line)) {
      section = "maybe";
      sawHeader = true;
      continue;
    }
    if (COMMANDER_LINE_REGEX.test(line)) {
      section = "commander";
      sawHeader = true;
      continue;
    }
    if (MAIN_SECTION_LINE_REGEX.test(line)) {
      section = "main";
      sawHeader = true;
      continue;
    }
    if (isComment) continue;
    const match = line.match(DECK_LINE_REGEX);
    if (!match) continue;
    let rest = match[2].trim();
    const commentMatch = rest.match(COMMENT_SUFFIX_REGEX);
    const commanderHint = /^!?\s*commander/i.test(commentMatch?.[1]?.trim() ?? "");
    if (commentMatch) rest = rest.replace(COMMENT_SUFFIX_REGEX, "");
    rest = rest.replace(DECKSTATS_SET_PREFIX_REGEX, "").replace(LABEL_SUFFIX_REGEX, "");
    const categoryMatch = rest.match(CATEGORY_SUFFIX_REGEX);
    const categories = (categoryMatch?.[1] ?? "")
      .toLowerCase()
      .split(",")
      .map((c) => c.trim());
    if (categoryMatch) rest = rest.replace(CATEGORY_SUFFIX_REGEX, "");
    rest = rest.trim();
    const setMatch = rest.match(SET_SUFFIX_REGEX);
    const name = rest.replace(SET_SUFFIX_REGEX, "").trim();
    if (!name) continue;
    const inCategory = (prefix: string) => categories.some((c) => c.startsWith(prefix));
    blockOf.push(block);
    entries.push({
      count: parseInt(match[1], 10),
      name,
      side: section === "side" || inCategory("sideboard"),
      maybe: section === "maybe" || inCategory("maybeboard") || inCategory("considering"),
      commander: section === "commander" || inCategory("commander") || commanderHint,
      setCode: setMatch?.[1]?.toLowerCase(),
      collectorNumber: setMatch?.[2],
      foil: setMatch?.[3] ? true : undefined,
    });
  }
  markHeaderlessCommanderBlock(entries, blockOf, sawHeader);
  return entries;
}

function markHeaderlessCommanderBlock(
  entries: ParsedDeckEntry[],
  blockOf: number[],
  sawHeader: boolean,
): void {
  if (sawHeader || entries.some((e) => e.commander || e.side || e.maybe)) return;
  const lastBlock = blockOf.at(-1);
  if (lastBlock === undefined || lastBlock === 0) return;
  for (const candidateBlock of [lastBlock, 0]) {
    const candidate = entries.filter((_, index) => blockOf[index] === candidateBlock);
    const mainCount = entries.reduce(
      (sum, entry, index) => (blockOf[index] === candidateBlock ? sum : sum + entry.count),
      0,
    );
    if (
      candidate.length >= 1 &&
      candidate.length <= 2 &&
      candidate.every((entry) => entry.count === 1) &&
      mainCount >= HEADERLESS_COMMANDER_MIN_MAIN
    ) {
      for (const entry of candidate) entry.commander = true;
      return;
    }
  }
}

export interface ResolvedDeckImportSections {
  cards: DeckCard[];
  sideboard: DeckCard[];
  maybeboard: DeckCard[];
  commanders: DeckCard[];
}

export function mergeDeckImportIntoDeck(
  deck: EditorDeck,
  sections: ResolvedDeckImportSections,
): EditorDeck {
  const hasCommanders = (deck.commanders?.length ?? 0) > 0;
  const importsCommanders = sections.commanders.length > 0;
  const format =
    importsCommanders && !formatRequiresCommander(deck.format) ? "commander" : deck.format;
  const keepsImportedCommanders = formatRequiresCommander(format) && !hasCommanders;
  const commanders = keepsImportedCommanders ? sections.commanders : (deck.commanders ?? []);
  const importedMain = keepsImportedCommanders
    ? sections.cards
    : [...sections.cards, ...sections.commanders];
  return {
    ...deck,
    name: resolveDeckName(deck.name, commanders),
    format,
    cards: [...deck.cards, ...importedMain],
    sideboard: [...deck.sideboard, ...sections.sideboard],
    maybeboard: [...(deck.maybeboard ?? []), ...sections.maybeboard],
    commanders,
  };
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

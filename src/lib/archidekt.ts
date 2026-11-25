// Pure Archidekt client. No React, no Node, no side effects beyond the
// injected fetch. Shared by the CLI importer and the in-app deck importer.

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface ArchidektSearchResult {
  id: string;
  name: string;
  author: string;
  format: string;
  description: string;
  tags: string[];
}

export interface ArchidektDeckCard {
  name: string;
  count: number;
  set?: string;
  cardNumber?: string;
}

export interface ArchidektDeck {
  id: string;
  name: string;
  description: string;
  colors: string[];
  cards: ArchidektDeckCard[];
  commanders: ArchidektDeckCard[];
  signatureSpells?: ArchidektDeckCard[];
}

export const ARCHIDEKT_FORMATS: Record<number, string> = {
  1: "Standard",
  2: "Modern",
  3: "Commander / EDH",
  4: "Legacy",
  5: "Vintage",
  6: "Pauper",
  7: "Custom",
  8: "Frontier",
  9: "Future Standard",
  10: "Penny Dreadful",
  11: "Historic",
  12: "Pioneer",
  13: "Brawl",
  14: "Commander 1v1",
  15: "Duel Commander",
  16: "Oathbreaker",
  17: "Pauper EDH",
  18: "Alchemy",
  19: "Explorer",
  20: "Historic Brawl",
  21: "Premodern",
  22: "Predh",
  23: "Timeless",
};

export const GAME_FORMAT_TO_ARCHIDEKT: Record<string, number> = {
  standard: 1,
  modern: 2,
  commander: 3,
  legacy: 4,
  vintage: 5,
  pauper: 6,
  paupercommander: 17,
  pioneer: 12,
  premodern: 21,
};

export const ARCHIDEKT_PAGE_SIZE = 25;

export const ARCHIDEKT_API = "https://archidekt.com/api";

const USER_AGENT = "manabrew-deck-importer";

export interface RequestOptions {
  fetch?: FetchFn;
  signal?: AbortSignal;
}

function resolveFetch(opts?: RequestOptions): FetchFn {
  const f = opts?.fetch ?? (globalThis as { fetch?: FetchFn }).fetch;
  if (!f) throw new Error("No fetch implementation available");
  return f;
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => (typeof t === "string" ? t : (t as { name?: string } | null)?.name))
    .filter((t): t is string => typeof t === "string" && t.length > 0);
}

function normalizeDescription(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim();
}

interface RawSearchResult {
  id: number;
  name: string;
  owner?: { username?: string };
  deckFormat?: number;
  description?: string | null;
  tags?: unknown;
}

interface RawSearchResponse {
  results?: RawSearchResult[];
}

function mapSearchResult(d: RawSearchResult): ArchidektSearchResult {
  return {
    id: String(d.id),
    name: d.name,
    author: d.owner?.username ?? "unknown",
    format: (d.deckFormat != null && ARCHIDEKT_FORMATS[d.deckFormat]) || "",
    description: normalizeDescription(d.description),
    tags: normalizeTags(d.tags),
  };
}

const ARCHIDEKT_DECK_URL_REGEX = /archidekt\.com\/decks\/(\d+)/i;

export function parseArchidektUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = ARCHIDEKT_DECK_URL_REGEX.exec(trimmed);
  return match ? match[1] : null;
}

export function parseArchidektDeckLink(input: string): string | null {
  const trimmed = input.trim();
  if (/\s/.test(trimmed)) return null;
  return ARCHIDEKT_DECK_URL_REGEX.exec(trimmed)?.[1] ?? null;
}

export async function searchArchidekt(
  query: string,
  opts: RequestOptions & { pageSize?: number; formatId?: string } = {},
): Promise<ArchidektSearchResult[]> {
  const fetchFn = resolveFetch(opts);
  const pageSize = opts.pageSize ?? ARCHIDEKT_PAGE_SIZE;
  const formatCode = opts.formatId ? GAME_FORMAT_TO_ARCHIDEKT[opts.formatId] : undefined;
  const formatParam = formatCode ? `&deckFormat=${formatCode}` : "";
  const url = `https://archidekt.com/api/decks/v3/?name=${encodeURIComponent(query)}&pageSize=${pageSize}&orderBy=-viewCount${formatParam}`;
  const res = await fetchFn(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Archidekt search failed: ${res.status}`);
  const data = (await res.json()) as RawSearchResponse;
  return (data.results ?? []).map(mapSearchResult);
}

interface RawDeckResponse {
  id: number;
  name: string;
  description?: string | null;
  deckFormat?: number;
  owner?: { username?: string };
  tags?: unknown;
  categories?: Array<{ name: string; includedInDeck?: boolean }>;
  cards?: Array<{
    quantity: number;
    categories?: string[];
    modifier?: string;
    card?: {
      name?: string;
      collectorNumber?: string;
      edition?: {
        editioncode?: string;
        editionCode?: string;
      };
      oracleCard?: {
        name?: string;
        colorIdentity?: string[];
      };
    };
  }>;
}

const EXCLUDED_CATEGORIES = new Set(["sideboard", "maybeboard"]);
const COMMANDER_CATEGORIES = new Set(["commander", "commanders"]);

async function fetchRawDeck(
  id: string,
  opts: RequestOptions,
  baseUrl = ARCHIDEKT_API,
): Promise<RawDeckResponse> {
  const fetchFn = resolveFetch(opts);
  const res = await fetchFn(`${baseUrl}/decks/${id}/`, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
  });
  if (res.status === 404) throw new Error(`Archidekt deck not found or private`);
  if (!res.ok) throw new Error(`Archidekt fetch failed: ${res.status}`);
  return (await res.json()) as RawDeckResponse;
}

export async function fetchArchidektDeck(
  id: string,
  opts: RequestOptions = {},
): Promise<ArchidektDeck> {
  const data = await fetchRawDeck(id, opts);
  const cards: ArchidektDeckCard[] = [];
  const commanders: ArchidektDeckCard[] = [];
  const colors = new Set<string>();
  for (const entry of data.cards ?? []) {
    const categories = (entry.categories ?? []).map((c) => c.toLowerCase());
    if (categories.some((c) => EXCLUDED_CATEGORIES.has(c))) continue;
    const name = entry.card?.oracleCard?.name ?? entry.card?.name;
    if (!name) continue;
    const target = categories.some((c) => COMMANDER_CATEGORIES.has(c)) ? commanders : cards;
    const set = (
      entry.card?.edition?.editioncode ?? entry.card?.edition?.editionCode
    )?.toLowerCase();
    const cardNumber = entry.card?.collectorNumber;
    target.push({ name, count: entry.quantity, set, cardNumber });
    for (const c of entry.card?.oracleCard?.colorIdentity ?? []) colors.add(c);
  }
  return {
    id: String(data.id),
    name: data.name,
    description: typeof data.description === "string" ? data.description : "",
    colors: [...colors],
    cards,
    commanders,
  };
}

export async function fetchArchidektResult(
  id: string,
  opts: RequestOptions = {},
): Promise<ArchidektSearchResult> {
  const d = await fetchRawDeck(id, opts);
  return mapSearchResult({
    id: d.id,
    name: d.name,
    owner: d.owner,
    deckFormat: d.deckFormat,
    description: d.description,
    tags: d.tags,
  });
}

export interface ArchidektDeckList {
  name: string;
  format?: string;
  text: string;
}

const DECK_LIST_SECTIONS = ["Commander", "Deck", "Sideboard", "Maybeboard"] as const;
type DeckListSection = (typeof DECK_LIST_SECTIONS)[number];

const SET_CODE_REGEX = /^[a-z0-9]{2,6}$/i;
const COLLECTOR_NUMBER_REGEX = /^[\w-]+$/;

function deckListSection(categories: string[], excluded: Set<string>): DeckListSection {
  if (categories.some((c) => COMMANDER_CATEGORIES.has(c))) return "Commander";
  if (categories.includes("sideboard")) return "Sideboard";
  if (categories.includes("maybeboard") || excluded.has(categories[0])) return "Maybeboard";
  return "Deck";
}

function deckListPrinting(set: string | undefined, cardNumber: string | undefined, foil: boolean) {
  if (!set || !SET_CODE_REGEX.test(set)) return "";
  const number = cardNumber && COLLECTOR_NUMBER_REGEX.test(cardNumber) ? ` ${cardNumber}` : "";
  return ` (${set.toUpperCase()})${number}${foil ? " *F*" : ""}`;
}

export async function fetchArchidektDeckList(
  id: string,
  opts: RequestOptions & { baseUrl?: string } = {},
): Promise<ArchidektDeckList> {
  const data = await fetchRawDeck(id, opts, opts.baseUrl);
  const excluded = new Set(
    (data.categories ?? [])
      .filter((c) => c.includedInDeck === false)
      .map((c) => c.name.toLowerCase()),
  );
  const sections = new Map<DeckListSection, string[]>(DECK_LIST_SECTIONS.map((s) => [s, []]));
  for (const entry of data.cards ?? []) {
    const name = entry.card?.oracleCard?.name ?? entry.card?.name;
    if (!name) continue;
    const categories = (entry.categories ?? []).map((c) => c.toLowerCase());
    const set = entry.card?.edition?.editioncode ?? entry.card?.edition?.editionCode;
    const printing = deckListPrinting(set, entry.card?.collectorNumber, entry.modifier === "Foil");
    sections
      .get(deckListSection(categories, excluded))!
      .push(`${entry.quantity} ${name}${printing}`);
  }
  const text = DECK_LIST_SECTIONS.filter((s) => sections.get(s)!.length > 0)
    .map((s) => [s, ...sections.get(s)!].join("\n"))
    .join("\n\n");
  const format = Object.keys(GAME_FORMAT_TO_ARCHIDEKT).find(
    (key) => GAME_FORMAT_TO_ARCHIDEKT[key] === data.deckFormat,
  );
  return { name: data.name, format, text };
}

import {
  MANA_CODE_FILE_OVERRIDES,
  MANA_CODE_SET,
  type ManaCode,
  type ScryfallCard,
  type ScryfallListResponse,
  type ScryfallRulingsResponse,
  type ScryfallSet,
} from "@/types/scryfall";
import { platformFetch } from "@/lib/platformFetch";
import { enqueueCardLookup } from "./scryfallBatch";

export const SCRYFALL_API = "https://api.scryfall.com";
export const COLLECTION_BATCH_SIZE = 75;
const SCRYFALL_MAX_RETRIES = 3;
const SCRYFALL_REQUEST_INTERVAL_MS = 300;
const SCRYFALL_DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;

let nextScryfallRequestAt = 0;
let scryfallCooldownUntil = 0;
let scryfallQueue = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const retryDate = Date.parse(retryAfter);
  if (Number.isNaN(retryDate)) return null;
  return Math.max(retryDate - Date.now(), 0);
}

export function scryfallCardKey(name: string, setCode?: string): string {
  return setCode ? `${name.toLowerCase()}::${setCode.toLowerCase()}` : name.toLowerCase();
}

async function waitForScryfallSlot(): Promise<void> {
  const now = Date.now();
  const earliestRequestAt = Math.max(nextScryfallRequestAt, scryfallCooldownUntil);
  const waitMs = Math.max(earliestRequestAt - now, 0);
  nextScryfallRequestAt = Math.max(now, earliestRequestAt) + SCRYFALL_REQUEST_INTERVAL_MS;
  if (waitMs > 0) await sleep(waitMs);
}

function applyScryfallCooldown(response: Response): number {
  const retryAfterMs =
    parseRetryAfterMs(response.headers.get("retry-after")) ??
    SCRYFALL_DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  scryfallCooldownUntil = Math.max(scryfallCooldownUntil, Date.now() + retryAfterMs);
  nextScryfallRequestAt = Math.max(nextScryfallRequestAt, scryfallCooldownUntil);
  return retryAfterMs;
}

async function queuedScryfallFetch(url: string, init?: RequestInit): Promise<Response> {
  const scheduled = scryfallQueue.then(waitForScryfallSlot, waitForScryfallSlot);
  scryfallQueue = scheduled.catch(() => undefined);
  await scheduled;
  return platformFetch(url, init);
}

export async function scryfallFetch<T>(
  url: string,
  errorMsg: string,
  init?: RequestInit,
): Promise<T> {
  for (let attempt = 0; attempt <= SCRYFALL_MAX_RETRIES; attempt += 1) {
    const response = await queuedScryfallFetch(url, init);
    if (response.status === 429 && attempt < SCRYFALL_MAX_RETRIES) {
      const retryAfterMs = applyScryfallCooldown(response);
      console.warn(`SCRYFALL 429; pausing queue for ${Math.ceil(retryAfterMs / 1000)}s`);
      await sleep(retryAfterMs);
      continue;
    }
    if (!response.ok) {
      throw new Error(`${errorMsg} (HTTP ${response.status})`);
    }
    return response.json();
  }
  throw new Error(errorMsg);
}

export async function searchCards(
  query: string,
  page: number = 1,
  order?: string,
  dir?: string,
): Promise<ScryfallListResponse> {
  const orderParam = order || "cmc";
  const dirParam = dir && dir !== "auto" ? `&dir=${dir}` : "";
  return scryfallFetch(
    `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&page=${page}&order=${orderParam}&unique=cards${dirParam}`,
    "Failed to fetch cards from Scryfall",
  );
}
export async function getRulings(rulingsUri: string): Promise<ScryfallRulingsResponse> {
  return scryfallFetch(rulingsUri, "Failed to fetch rulings from Scryfall");
}
export async function getCardPrints(printsSearchUri: string): Promise<ScryfallListResponse> {
  return scryfallFetch(printsSearchUri, "Failed to fetch card prints from Scryfall");
}

export async function getCardByName(name: string, setCode?: string): Promise<ScryfallCard> {
  return enqueueCardLookup(setCode ? { name, set: setCode.toLowerCase() } : { name });
}
export async function getCardById(id: string): Promise<ScryfallCard> {
  return enqueueCardLookup({ id });
}
export async function getCardBySetAndNumber(
  setCode: string,
  collectorNumber: string,
): Promise<ScryfallCard> {
  return enqueueCardLookup({ set: setCode.toLowerCase(), collector_number: collectorNumber });
}
export async function fetchCardCollection(
  cards: { name: string; setCode?: string }[],
): Promise<Map<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();
  const unique = Array.from(
    new Map(cards.map((c) => [scryfallCardKey(c.name, c.setCode), c])).values(),
  );
  for (let i = 0; i < unique.length; i += COLLECTION_BATCH_SIZE) {
    const batch = unique.slice(i, i + COLLECTION_BATCH_SIZE);
    const identifiers = batch.map((c) =>
      c.setCode ? { name: c.name, set: c.setCode.toLowerCase() } : { name: c.name },
    );
    try {
      const data = await scryfallFetch<{ data: ScryfallCard[]; not_found: { name: string }[] }>(
        `${SCRYFALL_API}/cards/collection`,
        "Failed to fetch card collection from Scryfall",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers }),
        },
      );
      for (const card of data.data) {
        const setAwareKey = scryfallCardKey(card.name, card.set);
        const legacyKey = scryfallCardKey(card.name);
        result.set(setAwareKey, card);
        if (!result.has(legacyKey)) {
          result.set(legacyKey, card);
        }
      }
    } catch {
      // best-effort per batch
    }
  }
  return result;
}
export function getScryfallManaCost(card: ScryfallCard): string | undefined {
  const sc = card as unknown as {
    card_faces?: { mana_cost?: string }[];
    mana_cost?: string;
  };
  return sc.mana_cost ?? sc.card_faces?.[0]?.mana_cost;
}
export async function fetchSets(): Promise<ScryfallSet[]> {
  const data = await scryfallFetch<{ data: ScryfallSet[] }>(
    `${SCRYFALL_API}/sets`,
    "Failed to fetch sets from Scryfall",
  );
  return data.data;
}

export async function fetchCardsBySet(setCode: string): Promise<ScryfallCard[]> {
  const out: ScryfallCard[] = [];
  let url: string | undefined =
    `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(`e:${setCode.toLowerCase()}`)}` +
    `&unique=prints&order=set&include_extras=true`;

  while (url) {
    const page: ScryfallListResponse = await scryfallFetch<ScryfallListResponse>(
      url,
      `Failed to fetch cards for set ${setCode}`,
    );
    out.push(...page.data);
    url = page.has_more ? page.next_page : undefined;
  }
  if (out.length === 0) {
    throw new Error(`Scryfall returned no cards for set ${setCode}`);
  }
  return out;
}

export function fetchImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = scryfallCorsImageUrl(url);
  });
}

function scryfallCorsImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!["cards.scryfall.io", "backs.scryfall.io"].includes(parsed.hostname)) return url;
    parsed.searchParams.set("manabrew_cors", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

export function normalizeManaCode(value: string): ManaCode | null {
  const normalized = value.trim().toUpperCase();
  return MANA_CODE_SET.has(normalized) ? (normalized as ManaCode) : null;
}

export function isManaCode(value: string): value is ManaCode {
  return normalizeManaCode(value) === value;
}

export const manaSymbolUrl = (code: ManaCode) => {
  const filename = MANA_CODE_FILE_OVERRIDES[code] ?? code.replace(/\//g, "");
  const base =
    import.meta.env.VITE_SCRYFALL_SYMBOL_BASE || "https://svgs.scryfall.io/card-symbols/";
  return `${base}${encodeURIComponent(filename)}.svg`;
};

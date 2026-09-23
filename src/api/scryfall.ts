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
import { getPlatformType } from "@/platform";
import { loadScryfallImage } from "@/lib/scryfallImageSource";
import {
  localCardNames,
  localCardRecord,
  localCardRecords,
  localRulings,
  localSets,
} from "@/lib/localCardRecords";
import { bestCachedName, cachedNameMatches } from "@/lib/localCardSearch";
import { scryfallAssetUrl, scryfallAssetsMirrored } from "@/lib/scryfallAssets";
import {
  enqueueCardLookup,
  matchesIdentifier,
  normalizeIdentifierForRequest,
  type CardIdentifier,
} from "./scryfallBatch";
import { DEFAULT_SCRYFALL_LANGUAGE, type ScryfallLanguage } from "@/i18n/locales";

export const SCRYFALL_API = "https://api.scryfall.com";
export const COLLECTION_BATCH_SIZE = 75;
const SCRYFALL_REQUEST_INTERVAL_MS = 500;
const SCRYFALL_DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;

let nextScryfallRequestAt = 0;
let scryfallCooldownUntil = 0;
let scryfallQueue = Promise.resolve();

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
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

export function scryfallCardKey(name: string, setCode?: string, collectorNumber?: string): string {
  const base = setCode ? `${name.toLowerCase()}::${setCode.toLowerCase()}` : name.toLowerCase();
  return setCode && collectorNumber ? `${base}::${collectorNumber.toLowerCase()}` : base;
}

async function waitForScryfallSlot(signal?: AbortSignal | null): Promise<void> {
  const now = Date.now();
  const earliestRequestAt = Math.max(nextScryfallRequestAt, scryfallCooldownUntil);
  const waitMs = Math.max(earliestRequestAt - now, 0);
  nextScryfallRequestAt = Math.max(now, earliestRequestAt) + SCRYFALL_REQUEST_INTERVAL_MS;
  if (waitMs > 0) await sleep(waitMs, signal);
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
  const scheduled = scryfallQueue.then(
    () => waitForScryfallSlot(init?.signal),
    () => waitForScryfallSlot(init?.signal),
  );
  scryfallQueue = scheduled.catch(() => undefined);
  await scheduled;
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json;q=0.9,*/*;q=0.8");
  return platformFetch(url, { ...init, headers });
}

export async function scryfallFetch<T>(
  url: string,
  errorMsg: string,
  init?: RequestInit,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await queuedScryfallFetch(url, init);
    if (response.status === 429) {
      const retryAfterMs = applyScryfallCooldown(response);
      if (attempt === 0) continue;
      throw new Error(
        `Scryfall is rate limited. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      );
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
  try {
    return await scryfallFetch<ScryfallListResponse>(
      `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&page=${page}&order=${orderParam}&unique=cards${dirParam}`,
      "Failed to fetch cards from Scryfall",
    );
  } catch (error) {
    // A cache is keyed by name, so the only query it can answer is words in a
    // title. Scryfall's operators (`t:`, `c:`, `cmc>=`) have no offline
    // equivalent and the search stays failed rather than answering something
    // narrower than what was asked.
    const cached = await searchCachedNames(query, page);
    if (cached) return cached;
    throw error;
  }
}

const CACHED_SEARCH_PAGE_SIZE = 175;

async function searchCachedNames(
  query: string,
  page: number,
): Promise<ScryfallListResponse | null> {
  const names = await localCardNames();
  if (!names) return null;
  const matches = cachedNameMatches(query, names);
  if (!matches) return null;
  const start = (Math.max(page, 1) - 1) * CACHED_SEARCH_PAGE_SIZE;
  const wanted = matches.slice(start, start + CACHED_SEARCH_PAGE_SIZE);
  const found = await localCardRecords(wanted);
  return {
    object: "list",
    total_cards: matches.length,
    has_more: start + CACHED_SEARCH_PAGE_SIZE < matches.length,
    data: wanted.map((name) => found.get(name)).filter((card) => card !== undefined),
  };
}
export async function getRulings(
  rulingsUri: string,
  oracleId?: string,
): Promise<ScryfallRulingsResponse> {
  try {
    return await scryfallFetch<ScryfallRulingsResponse>(
      rulingsUri,
      "Failed to fetch rulings from Scryfall",
    );
  } catch (error) {
    // Scryfall's bulk rulings are grouped by oracle id, while `rulings_uri`
    // names the printing, so the cache can only answer when the caller has the
    // card in hand — which every caller does.
    const cached = oracleId ? await localRulings(oracleId) : null;
    if (cached) return cached;
    throw error;
  }
}
export async function getCardPrints(printsSearchUri: string): Promise<ScryfallListResponse> {
  return scryfallFetch(printsSearchUri, "Failed to fetch card prints from Scryfall");
}

const PRINT_SEARCH_ORACLE_BATCH_SIZE = 20;

export async function fetchPrintsByOracleIds(
  oracleIds: string[],
  onProgress?: (completed: number, total: number) => void,
  signal?: AbortSignal,
  language?: ScryfallLanguage,
): Promise<Map<string, ScryfallCard[]>> {
  const unique = [...new Set(oracleIds)];
  const result = new Map<string, ScryfallCard[]>();
  const batches = Math.ceil(unique.length / PRINT_SEARCH_ORACLE_BATCH_SIZE);
  let completed = 0;

  for (let index = 0; index < unique.length; index += PRINT_SEARCH_ORACLE_BATCH_SIZE) {
    const ids = unique.slice(index, index + PRINT_SEARCH_ORACLE_BATCH_SIZE);
    const query = `(${ids.map((id) => `oracleid:${id}`).join(" or ")})${
      language ? ` lang:${language}` : ""
    }`;
    let url: string | undefined =
      `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}` +
      "&unique=prints&order=released&dir=desc&include_extras=true";
    while (url) {
      const page: ScryfallListResponse = await scryfallFetch<ScryfallListResponse>(
        url,
        "Failed to fetch card printings from Scryfall",
        { signal },
      );
      for (const card of page.data) {
        const prints = result.get(card.oracle_id) ?? [];
        prints.push(card);
        result.set(card.oracle_id, prints);
      }
      url = page.has_more ? page.next_page : undefined;
    }
    completed += 1;
    onProgress?.(completed, batches);
  }

  return result;
}

export async function getCardByName(name: string, setCode?: string): Promise<ScryfallCard> {
  return enqueueCardLookup(setCode ? { name, set: setCode.toLowerCase() } : { name });
}
export async function fetchCardByFuzzyName(name: string): Promise<ScryfallCard> {
  try {
    return await scryfallFetch<ScryfallCard>(
      `${SCRYFALL_API}/cards/named?fuzzy=${encodeURIComponent(name)}`,
      `No card matches "${name}"`,
    );
  } catch (error) {
    // Scryfall does the fuzzing online. Offline the cache's own name list is
    // what a misspelling can be matched against, which is what makes pasting a
    // decklist work with no internet.
    const cached = await localCardRecord(name);
    if (cached) return cached;
    const guess = await localCardNames().then((names) =>
      names ? bestCachedName(name, names) : null,
    );
    const matched = guess ? await localCardRecord(guess) : null;
    if (matched) return matched;
    throw error;
  }
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

export async function getLocalizedCardPrinting(
  card: ScryfallCard,
  language: ScryfallLanguage,
): Promise<ScryfallCard> {
  if (language === DEFAULT_SCRYFALL_LANGUAGE || card.lang === language) return card;
  try {
    return await scryfallFetch<ScryfallCard>(
      `${SCRYFALL_API}/cards/${encodeURIComponent(card.set)}/${encodeURIComponent(card.collector_number)}/${language}`,
      `No ${language} printing exists for ${card.name}`,
    );
  } catch {
    return card;
  }
}
export async function fetchCardCollection(
  cards: { name: string; setCode?: string; collectorNumber?: string }[],
  signal?: AbortSignal,
): Promise<Map<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();
  const unique = Array.from(
    new Map(cards.map((c) => [scryfallCardKey(c.name, c.setCode, c.collectorNumber), c])).values(),
  );
  for (let i = 0; i < unique.length; i += COLLECTION_BATCH_SIZE) {
    const batch = unique.slice(i, i + COLLECTION_BATCH_SIZE);
    const ids: CardIdentifier[] = batch.map((c) =>
      c.setCode && c.collectorNumber
        ? { set: c.setCode.toLowerCase(), collector_number: c.collectorNumber }
        : c.setCode
          ? { name: c.name, set: c.setCode.toLowerCase() }
          : { name: c.name },
    );
    let fromCache = false;
    const data = await scryfallFetch<{ data: ScryfallCard[] }>(
      `${SCRYFALL_API}/cards/collection`,
      "Failed to fetch card collection from Scryfall",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: ids.map(normalizeIdentifierForRequest) }),
        signal,
      },
    ).catch(async (error) => {
      const cached = await localCardRecords(batch.map((c) => c.name));
      if (cached.size === 0) throw error;
      fromCache = true;
      return { data: [...cached.values()] };
    });
    batch.forEach((c, idx) => {
      // A cache holds one printing per card, so an exact-printing identifier
      // has nothing to match there and the name is all it can be asked for.
      // Online that stays a miss, where a wrong printing would be a wrong card.
      const card =
        data.data.find((found) => matchesIdentifier(found, ids[idx])) ??
        (fromCache
          ? data.data.find((found) => matchesIdentifier(found, { name: c.name }))
          : undefined);
      // A set+number identifier carries no name, so a mistyped number would
      // silently resolve to a different card in that set — reject it instead.
      if (!card || !matchesIdentifier(card, { name: c.name })) return;
      result.set(scryfallCardKey(c.name, c.setCode, c.collectorNumber), card);
      for (const fallbackKey of [scryfallCardKey(c.name, c.setCode), scryfallCardKey(c.name)]) {
        if (!result.has(fallbackKey)) result.set(fallbackKey, card);
      }
    });
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
  ).catch(async (error) => {
    const cached = await localSets();
    if (!cached) throw error;
    return { data: cached };
  });
  return data.data.map((set) => ({ ...set, icon_svg_uri: scryfallAssetUrl(set.icon_svg_uri) }));
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

const SCRYFALL_IMAGE_MAX_RETRIES = 3;

async function fetchImageBlob(url: string, cache: RequestCache): Promise<string> {
  const response = await fetch(url, {
    cache,
    credentials: "omit",
    mode: "cors",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return URL.createObjectURL(await response.blob());
}

function loadImageElement(
  src: string,
  originalUrl: string,
  revokeAfterLoad: boolean,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (revokeAfterLoad) URL.revokeObjectURL(src);
      resolve(img);
    };
    img.onerror = () => {
      if (revokeAfterLoad) URL.revokeObjectURL(src);
      reject(new Error(`image decode failed: ${originalUrl}`));
    };
    img.src = src;
  });
}

export async function fetchImageElement(url: string): Promise<HTMLImageElement> {
  const onDesktop = getPlatformType() === "tauri";
  if (onDesktop) {
    const src = await loadScryfallImage(url);
    return loadImageElement(src, url, false);
  }
  let lastError: unknown;
  for (let attempt = 0; attempt <= SCRYFALL_IMAGE_MAX_RETRIES; attempt += 1) {
    try {
      const objectUrl = await fetchImageBlob(url, "no-cache");
      return await loadImageElement(objectUrl, url, true);
    } catch (err) {
      lastError = err;
      console.error(`[scryfall-image] load failed`, {
        url,
        attempt: attempt + 1,
        of: SCRYFALL_IMAGE_MAX_RETRIES + 1,
        err,
      });
      if (attempt < SCRYFALL_IMAGE_MAX_RETRIES) {
        await sleep(2 ** attempt * 400);
      }
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `[scryfall-image] failed after ${SCRYFALL_IMAGE_MAX_RETRIES + 1} attempts: ${url} (${reason})`,
  );
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
  const file = `${encodeURIComponent(filename)}.svg`;
  if (scryfallAssetsMirrored)
    return scryfallAssetUrl(`https://svgs.scryfall.io/card-symbols/${file}`);
  const defaultBase =
    getPlatformType() === "web" ? "/scryfall-symbols/" : "https://svgs.scryfall.io/card-symbols/";
  return `${import.meta.env.VITE_SCRYFALL_SYMBOL_BASE || defaultBase}${file}`;
};

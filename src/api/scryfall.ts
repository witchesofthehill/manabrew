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
  enqueueCardLookup,
  matchesIdentifier,
  normalizeIdentifierForRequest,
  type CardIdentifier,
} from "./scryfallBatch";

export const SCRYFALL_API = "https://api.scryfall.com";
export const COLLECTION_BATCH_SIZE = 75;
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

export function scryfallCardKey(name: string, setCode?: string, collectorNumber?: string): string {
  const base = setCode ? `${name.toLowerCase()}::${setCode.toLowerCase()}` : name.toLowerCase();
  return setCode && collectorNumber ? `${base}::${collectorNumber.toLowerCase()}` : base;
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

const PRINT_SEARCH_ORACLE_BATCH_SIZE = 20;

export async function fetchPrintsByOracleIds(
  oracleIds: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, ScryfallCard[]>> {
  const unique = [...new Set(oracleIds)];
  const result = new Map<string, ScryfallCard[]>();
  const batches = Math.ceil(unique.length / PRINT_SEARCH_ORACLE_BATCH_SIZE);
  let completed = 0;

  for (let index = 0; index < unique.length; index += PRINT_SEARCH_ORACLE_BATCH_SIZE) {
    const ids = unique.slice(index, index + PRINT_SEARCH_ORACLE_BATCH_SIZE);
    const query = ids.map((id) => `oracleid:${id}`).join(" or ");
    let url: string | undefined =
      `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(`(${query})`)}` +
      "&unique=prints&order=released&dir=desc&include_extras=true";
    while (url) {
      const page: ScryfallListResponse = await scryfallFetch<ScryfallListResponse>(
        url,
        "Failed to fetch card printings from Scryfall",
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
  return scryfallFetch<ScryfallCard>(
    `${SCRYFALL_API}/cards/named?fuzzy=${encodeURIComponent(name)}`,
    `No card matches "${name}"`,
  );
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
  cards: { name: string; setCode?: string; collectorNumber?: string }[],
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
    const data = await scryfallFetch<{ data: ScryfallCard[] }>(
      `${SCRYFALL_API}/cards/collection`,
      "Failed to fetch card collection from Scryfall",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: ids.map(normalizeIdentifierForRequest) }),
      },
    );
    batch.forEach((c, idx) => {
      const card = data.data.find((found) => matchesIdentifier(found, ids[idx]));
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

const SCRYFALL_IMAGE_MAX_RETRIES = 3;

// cards.scryfall.io intermittently serves cached objects with NO CORS headers
// (verified 2026-07-15: `access-control-allow-origin` absent even with an
// Origin header, while svgs.scryfall.io still sends it), which makes every
// cors-mode fetch fail — and WebGL textures need cors-clean pixels, so a
// plain-<img> fallback can't save the Pixi board. Cache-busting is not an
// option either: the CDN 403s any unknown query param (the `mbcors=1`
// partition attempt turned soft failures into hard ones). Instead, card
// images are fetched same-origin through the `/scryfall-img/` proxy route
// (ops/Caddyfile + staging/standalone Caddyfiles in prod, the vite dev proxy
// locally) — same-origin needs no CORS at all. The direct CDN stays as the
// fallback for deployments without the route.
const SCRYFALL_IMAGE_CDN_PREFIX = "https://cards.scryfall.io/";

function scryfallImageProxyUrl(url: string): string | null {
  if (!url.startsWith(SCRYFALL_IMAGE_CDN_PREFIX)) return null;
  return `/scryfall-img/${url.slice(SCRYFALL_IMAGE_CDN_PREFIX.length)}`;
}

async function fetchImageBlob(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    mode: "cors",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return URL.createObjectURL(await response.blob());
}

async function fetchImageBlobNoCache(url: string): Promise<string> {
  const proxied = scryfallImageProxyUrl(url);
  if (proxied) {
    try {
      return await fetchImageBlob(proxied);
    } catch {
      // Proxy route missing or down — the direct CDN works whenever
      // scryfall's CORS headers are healthy.
    }
  }
  return await fetchImageBlob(url);
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
      const objectUrl = await fetchImageBlobNoCache(url);
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
  const base =
    import.meta.env.VITE_SCRYFALL_SYMBOL_BASE || "https://svgs.scryfall.io/card-symbols/";
  return `${base}${encodeURIComponent(filename)}.svg`;
};

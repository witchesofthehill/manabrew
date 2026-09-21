/**
 * What a cache can answer once `api.scryfall.com` cannot be reached: this
 * machine's own `/scryfall-card/`, then the host on this network that already
 * downloaded the cards.
 *
 * A cache of pictures alone cannot be drawn. Every image url the app knows
 * comes out of a Scryfall record, so with no internet a full cache still has
 * nothing to ask for, and a room on a switch paints blank cards. These are the
 * same records the art download streamed past, kept beside the images.
 *
 * Only ever a fallback: Scryfall is authoritative and fresher, and while it
 * answers nothing here is consulted.
 */
import type { ScryfallCard, ScryfallRulingsResponse, ScryfallSet } from "@/types/scryfall";
import { cardDataCached } from "@/api/cardArtCache";
import { lanCacheUrl } from "@/lib/lanCache";
import { localCardArtRouteAvailable } from "@/lib/scryfallImageSource";
import { getPlatformType } from "@/platform";

let cachedCount: Promise<number> | null = null;

function localCardCount(): Promise<number> {
  if (getPlatformType() !== "tauri") return Promise.resolve(0);
  cachedCount ??= cardDataCached().catch(() => 0);
  return cachedCount;
}

/** Whether this machine holds records of its own to read. */
async function localRoute(path: string): Promise<string | null> {
  if (!(await localCardArtRouteAvailable()) || (await localCardCount()) === 0) return null;
  return path;
}

async function readNearest<T>(path: string): Promise<T | null> {
  for (const url of [await localRoute(path), lanCacheUrl(path)]) {
    if (!url) continue;
    try {
      const response = await fetch(url);
      if (response.ok) return (await response.json()) as T;
    } catch {
      // No such host, or nothing cached: the next source gets a turn.
    }
  }
  return null;
}

/** The record for one exact name, from the nearest machine that has it. */
export function localCardRecord(name: string): Promise<ScryfallCard | null> {
  return readNearest<ScryfallCard>(`/scryfall-card/${encodeURIComponent(name)}`);
}

/**
 * One exact printing. A cache keeps the printing it was given — the one the
 * every-card download chose, or the one a deck carried — so this answers for a
 * deck whose art was downloaded and misses otherwise.
 */
export function localPrintingRecord(
  set: string,
  collectorNumber: string,
): Promise<ScryfallCard | null> {
  return readNearest<ScryfallCard>(
    `/scryfall-card/${encodeURIComponent(set)}/${encodeURIComponent(collectorNumber)}`,
  );
}

/** The set list, which no card record carries and every set symbol waits on. */
export async function localSets(): Promise<ScryfallSet[] | null> {
  const list = await readNearest<{ data: ScryfallSet[] }>("/scryfall-sets");
  return list?.data ?? null;
}

export function localRulings(oracleId: string): Promise<ScryfallRulingsResponse | null> {
  return readNearest<ScryfallRulingsResponse>(`/scryfall-rulings/${encodeURIComponent(oracleId)}`);
}

let names: Promise<string[] | null> | null = null;

/**
 * Every name the cache holds. A name-keyed cache cannot be searched, so this is
 * what lets a client match a misspelling or a partial title itself. Read once
 * and kept: it is one list of 38k strings and every miss would refetch it.
 */
export function localCardNames(): Promise<string[] | null> {
  names ??= readNearest<string[]>("/scryfall-names").then((list) =>
    Array.isArray(list) && list.length > 0 ? list : null,
  );
  return names;
}

export async function localCardRecords(names: string[]): Promise<Map<string, ScryfallCard>> {
  const found = new Map<string, ScryfallCard>();
  const records = await Promise.all(names.map((name) => localCardRecord(name)));
  names.forEach((name, index) => {
    const record = records[index];
    if (record) found.set(name, record);
  });
  return found;
}

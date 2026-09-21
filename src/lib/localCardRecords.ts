/**
 * Card records read from a cache instead of `api.scryfall.com`: this machine's
 * own `/scryfall-card/`, then the host on this network that already downloaded
 * them.
 *
 * A cache of pictures alone cannot be drawn. Every image url the app knows
 * comes out of a Scryfall record, so with no internet a full cache still has
 * nothing to ask for, and a room on a switch paints blank cards. These are the
 * same records the art download streamed past, kept beside the images.
 *
 * Only ever a fallback: Scryfall is authoritative and fresher, and while it
 * answers nothing here is consulted.
 */
import type { ScryfallCard, ScryfallSet } from "@/types/scryfall";
import { cardDataCached } from "@/api/cardArtCache";
import { lanCardUrl, lanSetsUrl } from "@/lib/lanCache";
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

async function readNearest<T>(local: string | null, lan: string | null): Promise<T | null> {
  for (const url of [local, lan]) {
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
export async function localCardRecord(name: string): Promise<ScryfallCard | null> {
  const path = `/scryfall-card/${encodeURIComponent(name)}`;
  return readNearest<ScryfallCard>(await localRoute(path), lanCardUrl(name));
}

/** The set list, which no card record carries and every set symbol waits on. */
export async function localSets(): Promise<ScryfallSet[] | null> {
  const list = await readNearest<{ data: ScryfallSet[] }>(
    await localRoute("/scryfall-sets"),
    lanSetsUrl(),
  );
  return list?.data ?? null;
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

import type { ScryfallCard, ScryfallImageUris } from "@/types/scryfall";
import type { ScryfallCardLookup } from "@/stores/useScryfallStore";

export const CARD_GLINT_CACHE = "manabrew-card-glint-0.5.2-offline-v1";
export const CARD_GLINT_MANIFEST_CACHE = `${CARD_GLINT_CACHE}-manifests`;
export const CARD_GLINT_RECORD_CACHE = `${CARD_GLINT_CACHE}-records`;

export interface OfflineCardRecord {
  info: ScryfallCard;
  imageInfo?: ScryfallCard;
  imageResolved?: boolean;
  uris: ScryfallImageUris;
}

export function offlineCacheAvailable(): boolean {
  return typeof caches !== "undefined" && globalThis.isSecureContext;
}

export function offlineCacheKey(kind: string, key: string): string {
  return new URL(`/__card-glint-offline/${kind}/${encodeURIComponent(key)}`, location.origin).href;
}

export async function cachedCardGlintAsset(url: string): Promise<Response | undefined> {
  if (!offlineCacheAvailable()) return undefined;
  return (await caches.open(CARD_GLINT_CACHE)).match(url);
}

function recordKey(lookup: ScryfallCardLookup, locale: string): string {
  const number = lookup.collectorNumber ?? lookup.cardNumber;
  const identity = lookup.id
    ? ["id", lookup.id]
    : lookup.setCode && number
      ? ["printing", lookup.setCode.toLowerCase(), number.toLowerCase()]
      : ["name", lookup.name?.toLowerCase(), lookup.setCode?.toLowerCase()];
  return offlineCacheKey("record", JSON.stringify([locale, identity]));
}

export async function installedCardRecord(
  lookup: ScryfallCardLookup,
  locale: string,
): Promise<OfflineCardRecord | undefined> {
  if (!offlineCacheAvailable()) return undefined;
  try {
    const response = await (
      await caches.open(CARD_GLINT_RECORD_CACHE)
    ).match(recordKey(lookup, locale));
    return response ? ((await response.json()) as OfflineCardRecord) : undefined;
  } catch {
    return undefined;
  }
}

export async function storeOfflineCardRecord(
  lookup: ScryfallCardLookup,
  locale: string,
  record: OfflineCardRecord,
): Promise<string[]> {
  const cache = await caches.open(CARD_GLINT_RECORD_CACHE);
  const { info } = record;
  const keys = [
    ...new Set([
      recordKey(lookup, locale),
      recordKey({ id: info.id }, locale),
      recordKey({ setCode: info.set, collectorNumber: info.collector_number }, locale),
      recordKey({ name: info.name, setCode: info.set }, locale),
    ]),
  ];
  const { imageInfo, imageResolved, uris } = record;
  for (const key of keys)
    await cache.put(key, Response.json({ info, imageInfo, imageResolved, uris }));
  return keys;
}

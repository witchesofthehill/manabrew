import { getPlatform } from "@/platform";
import { cacheKeyForImage, localCardArtRouteAvailable } from "@/lib/scryfallImageSource";
import type { Deck } from "@/protocol";
import type { ScryfallCard } from "@/types/scryfall";
import type { BattlefieldCardStyle } from "@/stores/usePreferencesStore";

/**
 * Which Scryfall variant each surface draws. `normal` is every DOM surface
 * (thumbnails, prompts, previews); the Pixi battlefield asks
 * `getCardTexture` for `border_crop` on the realistic style and `art_crop` on
 * the art and frame ones, so a download that skips those leaves the board
 * blank offline no matter how much art is cached.
 */
export type ArtVariant = "normal" | "border_crop" | "art_crop";

export const ALL_BATTLEFIELD_STYLES: BattlefieldCardStyle[] = ["realistic", "art", "frame"];

export function variantsForStyles(styles: BattlefieldCardStyle[]): ArtVariant[] {
  const variants = new Set<ArtVariant>(["normal"]);
  for (const style of styles) {
    variants.add(style === "realistic" ? "border_crop" : "art_crop");
  }
  return [...variants];
}

/** Measured over real cards: normal 113KB, border_crop 101KB, art_crop 77KB. */
const VARIANT_KB: Record<ArtVariant, number> = {
  normal: 113,
  border_crop: 101,
  art_crop: 77,
};

export function estimateBytes(variants: ArtVariant[], cards: number): number {
  return variants.reduce((sum, v) => sum + VARIANT_KB[v], 0) * 1024 * cards;
}

/** What `oracle_cards` holds: one printing per distinct card. */
export const ALL_CARDS_ESTIMATE = 38628;

export interface CardArtCacheStats {
  files: number;
  bytes: number;
  pinnedFiles: number;
  pinnedBytes: number;
}

export interface PreseedResult {
  alreadyCached: number;
  fetched: number;
  failed: number;
}

/** A machine that cannot read the cache back is never offered the download. */
export function cardArtCacheAvailable(): Promise<boolean> {
  return localCardArtRouteAvailable();
}

function everyCardIn(deck: Deck) {
  return [
    ...deck.cards,
    ...(deck.commanders ?? []),
    ...(deck.sideboard ?? []),
    ...(deck.maybeboard ?? []),
  ];
}

/** The names whose records a deck download keeps, matching the art it fetches. */
export function deckCardNames(deck: Deck): string[] {
  return everyCardIn(deck).map((card) => card.identity.name);
}

export function deckArtUrls(deck: Deck, variants: ArtVariant[]): string[] {
  const urls = new Set<string>();
  const cards = everyCardIn(deck);
  for (const card of cards) {
    for (const variant of variants) {
      const uri = card.uris?.[variant];
      if (uri && cacheKeyForImage(uri)) urls.add(uri);
    }
  }
  return [...urls];
}

export function preseedCardArt(urls: string[]): Promise<PreseedResult> {
  return getPlatform().invoke<PreseedResult>("preseed_card_art", { urls });
}

/** Keeps the records for cards whose art was just downloaded. The picture is
 *  worth nothing to a machine that cannot learn its url, and these are already
 *  in hand: the download only happens while online. */
export function cacheCardRecords(records: ScryfallCard[]): Promise<number> {
  return getPlatform().invoke<number>("cache_card_records", { records });
}

/** The estimate travels with the request so the shell can refuse a download
 *  the disk cannot hold, without a second copy of the per-variant sizes. */
export function downloadAllCardArt(variants: ArtVariant[]): Promise<PreseedResult> {
  return getPlatform().invoke<PreseedResult>("download_all_card_art", {
    variants,
    estimateBytes: estimateBytes(variants, ALL_CARDS_ESTIMATE),
  });
}

export function cancelCardArtDownload(): Promise<void> {
  return getPlatform().invoke<void>("cancel_card_art_download", {});
}

export interface BulkProgress {
  done: number;
  total: number;
  bytes: number;
}

export function cardArtCacheStats(): Promise<CardArtCacheStats> {
  return getPlatform().invoke<CardArtCacheStats>("card_art_cache_stats", {});
}

/** How many cards this machine can describe with no internet: written by the
 *  every-card download out of the same bulk file its urls came from. */
export function cardDataCached(): Promise<number> {
  return getPlatform().invoke<number>("card_data_cached", {});
}

export function clearCardArtCache(includeDownloaded: boolean): Promise<void> {
  return getPlatform().invoke<void>("clear_card_art_cache", { includeDownloaded });
}

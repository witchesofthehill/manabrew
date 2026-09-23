import type { DeckCard } from "@/protocol/deck";
import type { ScryfallCard, ScryfallImageUris } from "@/types/scryfall";
import type { ScryfallLanguage } from "@/i18n/locales";
import { resolveCardFaces } from "./cardFaces";

export function cardFaceImageUris(
  info: ScryfallCard,
  fallback?: ScryfallImageUris,
  faceIndex = 0,
  artwork?: ScryfallCard,
): ScryfallImageUris | undefined {
  if (info.image_status === "placeholder") {
    if (artwork && artwork.image_status !== "placeholder") {
      return resolveCardFaces(artwork).faces[faceIndex]?.imageUris;
    }
    return faceIndex === 0 && fallback && !fallback.normal.includes(info.id) ? fallback : undefined;
  }
  return resolveCardFaces(info).faces[faceIndex]?.imageUris ?? fallback;
}

export function localizedDeckCardImageUris(
  card: DeckCard,
  locale: ScryfallLanguage,
  faceIndex = 0,
  info?: ScryfallCard,
  artwork?: ScryfallCard,
): ScryfallImageUris | undefined {
  if (info?.image_status === "placeholder") {
    if (card.imageLanguage !== locale) return undefined;
    const uris = faceIndex === 0 ? card.uris : faceIndex === 1 ? card.backFace?.uris : undefined;
    return uris?.normal &&
      !uris.normal.includes(info.id) &&
      !(artwork?.image_status === "placeholder" && uris.normal.includes(artwork.id))
      ? uris
      : undefined;
  }
  if (card.imageLanguage !== locale) return undefined;
  if (faceIndex === 0) return card.uris;
  return faceIndex === 1 ? card.backFace?.uris : undefined;
}

import type { DeckCard } from "@/protocol/deck";
import type { ScryfallCard, ScryfallImageUris } from "@/types/scryfall";
import type { ScryfallLanguage } from "@/i18n/locales";
import { resolveCardFaces } from "./cardFaces";

export function cardFaceImageUris(
  info: ScryfallCard,
  fallback?: ScryfallImageUris,
  faceIndex = 0,
): ScryfallImageUris | undefined {
  return resolveCardFaces(info).faces[faceIndex]?.imageUris ?? fallback;
}

export function localizedDeckCardImageUris(
  card: DeckCard,
  locale: ScryfallLanguage,
  faceIndex = 0,
): ScryfallImageUris | undefined {
  if (card.imageLanguage !== locale) return undefined;
  if (faceIndex === 0) return card.uris;
  return faceIndex === 1 ? card.backFace?.uris : undefined;
}

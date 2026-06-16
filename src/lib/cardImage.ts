import type { ScryfallCard, ScryfallImageUris } from "@/types/scryfall";

/**
 * Image uris for one face of a card. Reads the face's own `image_uris` (present
 * on transform / modal DFCs), falling back to the card's top-level image (split
 * and single-faced cards carry one image), then to an explicit fallback (the
 * store's precomputed uris). This is the front-face resolution the deck editor
 * uses; centralising it here lets the battlefield and the settings preview
 * render double-faced art the same way instead of relying on the brittle
 * `/front/` URL heuristic in `chooseImageUrisForCard`.
 */
export function cardFaceImageUris(
  info: ScryfallCard,
  fallback?: ScryfallImageUris,
  faceIndex = 0,
): ScryfallImageUris | undefined {
  return info.card_faces?.[faceIndex]?.image_uris ?? info.image_uris ?? fallback;
}

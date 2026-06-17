import type { ScryfallCard, ScryfallImageUris } from "@/types/scryfall";
import { resolveCardFaces } from "./cardFaces";

/**
 * Image uris for one face of a card, resolved through the central
 * {@link resolveCardFaces} so the battlefield, deck editor, and previews all
 * pick faces the same way. Falls back to the supplied uris (e.g. the store's
 * precomputed front image) when the face or card isn't available.
 */
export function cardFaceImageUris(
  info: ScryfallCard,
  fallback?: ScryfallImageUris,
  faceIndex = 0,
): ScryfallImageUris | undefined {
  return resolveCardFaces(info).faces[faceIndex]?.imageUris ?? fallback;
}

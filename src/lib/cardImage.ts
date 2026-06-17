import type { ScryfallCard, ScryfallImageUris } from "@/types/scryfall";
import { resolveCardFaces } from "./cardFaces";

export function cardFaceImageUris(
  info: ScryfallCard,
  fallback?: ScryfallImageUris,
  faceIndex = 0,
): ScryfallImageUris | undefined {
  return resolveCardFaces(info).faces[faceIndex]?.imageUris ?? fallback;
}

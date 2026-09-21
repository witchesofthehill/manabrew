import { ImageSource, Texture } from "pixi.js";
import { CARD_BACK_IMAGE_URL } from "@/components/game/game.constants";
import { fetchImageElement } from "@/api/scryfall";

let cardBackTexture: Texture | null = null;
let cardBackPromise: Promise<Texture> | null = null;

export function loadCardBack(): Promise<Texture> {
  if (cardBackTexture) return Promise.resolve(cardBackTexture);
  if (!cardBackPromise) {
    cardBackPromise = fetchImageElement(CARD_BACK_IMAGE_URL)
      .then((image) => {
        cardBackTexture = new Texture({ source: new ImageSource({ resource: image }) });
        return cardBackTexture;
      })
      .catch((error: unknown) => {
        cardBackPromise = null;
        throw error;
      });
  }
  return cardBackPromise;
}

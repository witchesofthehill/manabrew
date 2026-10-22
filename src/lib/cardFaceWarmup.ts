import type { Deck } from "@/protocol/deck";
import { getDeckCardPool } from "@/lib/decks";
import { renderCard, type CardRenderOptions } from "@/lib/cardRenderer";
import { releaseCardRaster, selectCardRenderTier } from "@/lib/cardRenderTypes";
import { GAME_CARD_SIZES } from "@/components/game/game.constants";
import { overlayResolution } from "@/pixi/overlay/overlayRuntime";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

const WARM_BATCH = 8;

let warmGeneration = 0;

export function manabrewRenderVariants(): CardRenderOptions[] {
  const preferences = usePreferencesStore.getState();
  const resolution = overlayResolution(window.innerWidth, window.innerHeight);
  const variants: CardRenderOptions[] = [];
  if (
    [
      preferences.handCardStyle,
      preferences.stackCardStyle,
      preferences.promptCardStyle,
      preferences.inGameCardPreviewStyle,
    ].includes("rules")
  ) {
    variants.push({
      rulesText: false,
      standardFrameFallback: true,
      tier: selectCardRenderTier(
        GAME_CARD_SIZES.prompt.width,
        GAME_CARD_SIZES.prompt.height,
        resolution,
      ),
    });
  }
  if (preferences.battlefieldCardStyle === "frame") {
    variants.push({
      tier: selectCardRenderTier(
        GAME_CARD_SIZES.battlefield.width,
        GAME_CARD_SIZES.battlefield.height,
        resolution,
      ),
    });
  }
  return variants;
}

export async function warmDeckFaces(decks: readonly Deck[]): Promise<void> {
  const generation = ++warmGeneration;
  const variants = manabrewRenderVariants();
  const requests = decks
    .flatMap(getDeckCardPool)
    .flatMap((deckCard) =>
      (deckCard.backFace ? ([0, 1] as const) : ([0] as const)).flatMap((faceIndex) =>
        variants.map((options) => ({ deckCard, faceIndex, options })),
      ),
    );
  for (let index = 0; index < requests.length; index += WARM_BATCH) {
    if (generation !== warmGeneration) return;
    await Promise.allSettled(
      requests.slice(index, index + WARM_BATCH).map(({ deckCard, faceIndex, options }) =>
        renderCard({ deckCard, faceIndex, gameplay: true }, undefined, {
          ...options,
          priority: "background",
        }).then(releaseCardRaster),
      ),
    );
  }
}

import { getUiFontSize, UI_FONT_FAMILY } from "@/themes/typography";
import { Container, Sprite, Text, Texture, type DestroyOptions } from "pixi.js";
import { getTheme } from "@/hooks/useTheme";
import { cardCosmeticsKey } from "@/lib/cardCosmetics";
import { isEtchedOnlyPrinting } from "@/lib/cardFinish";
import { renderCard } from "@/lib/cardRenderer";
import {
  releaseCardRaster,
  selectCardRenderTier,
  type CardRenderTier,
} from "@/lib/cardRenderTypes";
import { overlayResolution } from "@/pixi/overlay/overlayRuntime";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { CardFoil } from "@/pixi/effects/CardFoil";
import {
  createGeneratedCardTexture,
  getGeneratedCardArtWindows,
} from "@/pixi/generatedCardTexture";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { DraftCard } from "@/types/limited";

export class LimitedCardFace extends Container {
  private readonly image = new Sprite();
  private readonly foil: CardFoil;
  private readonly fallbackLabel = new Text({
    style: {
      fontFamily: UI_FONT_FAMILY,
      fontSize: getUiFontSize("label"),
      wordWrap: true,
      breakWords: true,
    },
  });
  private ownedTexture: Texture | null = null;
  private controller: AbortController | null = null;
  private contentKey = "";
  private cardWidth = 0;
  private cardHeight = 0;
  private fallbackText = "";
  private tier: CardRenderTier | undefined;
  private readonly request: () => void;

  constructor(request: () => void) {
    super();
    this.request = request;
    this.eventMode = "none";
    this.foil = new CardFoil(request);
    this.addChild(this.image, this.foil, this.fallbackLabel);
  }

  get imageReady(): boolean {
    return (
      this.image.visible && this.image.texture !== Texture.EMPTY && this.image.texture.width > 1
    );
  }

  setContent(card: DraftCard, width: number, height: number): void {
    this.cardWidth = width;
    this.cardHeight = height;
    const theme = getTheme();
    this.image.setSize(width, height);
    this.foil.setSurface(width, height, 6, theme);
    this.fallbackLabel.style.fontSize = getUiFontSize("label");
    this.fallbackLabel.style.fill = theme.appTheme.foreground;
    this.fallbackLabel.style.wordWrapWidth = width - 12;
    this.positionLabel();
    const locale = useScryfallStore.getState().locale;
    const style = usePreferencesStore.getState().inGameCardPreviewStyle;
    const tier = selectCardRenderTier(
      width,
      height,
      overlayResolution(window.innerWidth, window.innerHeight),
      this.tier,
    );
    const key = JSON.stringify([
      card.id,
      card.name,
      card.setCode,
      card.cardNumber,
      !!card.foil,
      cardCosmeticsKey(card.cosmetics),
      locale,
      style,
    ]);
    const contentChanged = key !== this.contentKey;
    if (!contentChanged && tier === this.tier) return;
    this.contentKey = key;
    this.tier = tier;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    if (contentChanged) this.showTexture(Texture.EMPTY);
    this.foil.setAppearance(!!card.foil, card.cosmetics);
    this.fallbackText = card.name;
    this.positionLabel();
    void this.load({ ...card }, style === "rules", locale, tier, controller);
  }

  private positionLabel(): void {
    this.fallbackLabel.text = this.fallbackText;
    while (
      this.fallbackLabel.height > this.cardHeight - 12 &&
      this.fallbackLabel.text.replace(/…$/, "").length > 1
    ) {
      this.fallbackLabel.text = `${this.fallbackLabel.text.replace(/…$/, "").slice(0, -1)}…`;
    }
    this.fallbackLabel.position.set(6, this.cardHeight / 2 - this.fallbackLabel.height / 2);
  }

  private showTexture(texture: Texture, owned = false): void {
    const previous = this.ownedTexture;
    this.ownedTexture = owned ? texture : null;
    this.image.texture = texture;
    this.image.setSize(this.cardWidth, this.cardHeight);
    const ready = texture !== Texture.EMPTY && texture.width > 1;
    this.image.visible = ready;
    this.fallbackLabel.visible = !ready;
    this.foil.setTexture(ready ? texture : null, undefined, this.image);
    this.foil.setArtWindows(getGeneratedCardArtWindows(texture));
    this.foil.setEnabled(ready);
    previous?.destroy(true);
    this.request();
  }

  private async load(
    card: DraftCard,
    generated: boolean,
    locale: string,
    tier: CardRenderTier,
    controller: AbortController,
  ): Promise<void> {
    const current = (): boolean =>
      !this.destroyed &&
      !controller.signal.aborted &&
      this.controller === controller &&
      locale === useScryfallStore.getState().locale;
    try {
      const { info, uris } = await useScryfallStore.getState().getCard({
        name: card.name,
        setCode: card.setCode,
        collectorNumber: card.cardNumber,
      });
      if (!current()) return;
      const deckCard = scryfallToDeckCard({ ...info, image_uris: info.image_uris ?? uris });
      deckCard.identity = { ...deckCard.identity, ...card };
      this.foil.setAppearance(!!card.foil, card.cosmetics, isEtchedOnlyPrinting(info.finishes));
      const scan = useScryfallStore
        .getState()
        .getCardTexture(deckCard, "full", 0)
        .catch(() => Texture.EMPTY);
      if (generated) {
        try {
          const raster = await renderCard({ deckCard, faceIndex: 0 }, controller.signal, {
            standardFrameFallback: true,
            tier,
          });
          try {
            if (!current()) return;
            this.showTexture(createGeneratedCardTexture(raster), true);
            return;
          } finally {
            releaseCardRaster(raster);
          }
        } catch (error: unknown) {
          if (!current()) return;
          console.warn("[limited] generated card render failed", card.name, error);
          if (this.ownedTexture) return;
        }
      }
      const texture = await scan;
      if (current() && texture !== Texture.EMPTY) this.showTexture(texture);
      if (current() && texture === Texture.EMPTY) {
        this.fallbackText = `${card.name}\nImage unavailable`;
        this.positionLabel();
        this.request();
      }
    } catch {
      if (current()) {
        this.fallbackText = `${card.name}\nImage unavailable`;
        this.positionLabel();
        this.request();
      }
    }
  }

  override destroy(_options?: DestroyOptions): void {
    this.controller?.abort();
    this.foil.setTexture(null);
    this.ownedTexture?.destroy(true);
    this.ownedTexture = null;
    super.destroy({ children: true, texture: false, textureSource: false });
  }
}

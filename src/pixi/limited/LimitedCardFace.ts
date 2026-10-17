import { Container, Sprite, Text, Texture, type DestroyOptions } from "pixi.js";
import { getTheme } from "@/hooks/useTheme";
import { cardCosmeticsKey } from "@/lib/cardCosmetics";
import { isEtchedOnlyPrinting } from "@/lib/cardFinish";
import { renderCard } from "@/lib/cardRenderer";
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
      fontFamily: "Alegreya Sans",
      fontSize: 13,
      wordWrap: true,
    },
  });
  private ownedTexture: Texture | null = null;
  private controller: AbortController | null = null;
  private contentKey = "";
  private cardWidth = 0;
  private cardHeight = 0;
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
    this.fallbackLabel.style.fill = theme.appTheme.foreground;
    this.fallbackLabel.style.wordWrapWidth = width - 12;
    this.positionLabel();
    const locale = useScryfallStore.getState().locale;
    const style = usePreferencesStore.getState().inGameCardPreviewStyle;
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
    if (key === this.contentKey) return;
    this.contentKey = key;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.showTexture(Texture.EMPTY);
    this.foil.setAppearance(!!card.foil, card.cosmetics);
    this.fallbackLabel.text = card.name;
    this.positionLabel();
    void this.load({ ...card }, style === "rules", locale, controller);
  }

  private positionLabel(): void {
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
    this.foil.setTexture(ready ? texture : null);
    this.foil.setArtWindows(getGeneratedCardArtWindows(texture));
    this.foil.setEnabled(ready);
    previous?.destroy(true);
    this.request();
  }

  private async load(
    card: DraftCard,
    generated: boolean,
    locale: string,
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
          const canvas = await renderCard({ deckCard, faceIndex: 0 }, controller.signal, {
            standardFrameFallback: true,
          });
          if (!current()) return;
          this.showTexture(createGeneratedCardTexture(canvas), true);
          return;
        } catch {
          if (!current()) return;
        }
      }
      const texture = await scan;
      if (current() && texture !== Texture.EMPTY) this.showTexture(texture);
      if (current() && texture === Texture.EMPTY) {
        this.fallbackLabel.text = `${card.name}\nImage unavailable`;
        this.positionLabel();
        this.request();
      }
    } catch {
      if (current()) {
        this.fallbackLabel.text = `${card.name}\nImage unavailable`;
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

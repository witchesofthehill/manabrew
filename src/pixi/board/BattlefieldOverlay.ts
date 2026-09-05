import { Container, Graphics, Text, type FederatedPointerEvent } from "pixi.js";
import type { CardDto } from "@/protocol/game";
import type { BattlefieldState } from "../types";
import { hexToNum } from "../colorUtils";
import { OVERLAY_LABEL_STYLE } from "../textStyles";
import {
  CARD_RADIUS,
  OVERLAY_LABEL_SELECT,
  SELECT_BUTTON_ALPHA,
  SELECT_BUTTON_HOVER_ALPHA,
} from "../constants";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import type { OverlayHost, SpriteEntry } from "./types";

export class BattlefieldOverlay {
  private host: OverlayHost;

  constructor(host: OverlayHost) {
    this.host = host;
  }

  handleCardTap(card: CardDto): void {
    this.host.getCallbacks().onClickCard?.(card);
  }

  rebuild(entry: SpriteEntry, state: BattlefieldState): void {
    const card = entry.sprite.card;
    const selectable = !!(
      state.selectableCardIds?.includes(card.id) && this.host.getCallbacks().onClickCard
    );
    entry.overlayActive = selectable;
    if (!selectable) {
      if (entry.overlay) entry.overlay.eventMode = "none";
      return;
    }
    if (entry.overlay) {
      entry.overlay.eventMode = "passive";
      return;
    }

    const overlay = new Container();
    overlay.eventMode = "passive";
    overlay.alpha = 0;
    overlay.pivot.set(CARD_W / 2, CARD_H / 2);
    this.host.getContainer().addChild(overlay);
    entry.overlay = overlay;

    const button = new Graphics();
    const paint = (hovered: boolean) => {
      button.clear();
      button.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS);
      button.fill({
        color: hexToNum(this.host.getTheme().gameTheme.cardRing),
        alpha: hovered ? SELECT_BUTTON_HOVER_ALPHA : SELECT_BUTTON_ALPHA,
      });
    };
    paint(false);
    button.eventMode = "static";
    button.cursor = "pointer";
    button.on("pointerover", () => {
      this.host.cancelHoverClear();
      this.host.setCardHovered(entry.sprite);
      paint(true);
    });
    button.on("pointermove", () => this.host.setCardHovered(entry.sprite, true));
    button.on("pointerout", () => {
      paint(false);
      this.host.scheduleHoverClear(card.id);
    });
    button.on("pointerdown", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.host.startCardDrag(entry.sprite, event);
    });
    button.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      if (this.host.isJustDragged(card.id)) return;
      this.handleCardTap(entry.sprite.card);
    });
    overlay.addChild(button);

    const label = new Text({ text: OVERLAY_LABEL_SELECT, style: OVERLAY_LABEL_STYLE });
    label.eventMode = "none";
    label.anchor.set(0.5);
    label.position.set(CARD_W / 2, CARD_H / 2);
    overlay.addChild(label);
  }

  refreshAll(): void {
    const state = this.host.getLastState();
    if (!state) return;
    for (const entry of this.host.getEntries().values()) {
      entry.overlay?.destroy({ children: true });
      entry.overlay = null;
      this.rebuild(entry, state);
    }
  }
}

import {
  Container,
  Graphics,
  Sprite,
  Text,
  type FederatedPointerEvent,
  type Texture,
} from "pixi.js";
import type { CardDto } from "@/protocol/game";
import type { BattlefieldState } from "../types";
import { hexToNum } from "../colorUtils";
import {
  extractManaLetters,
  getDisplayedManaAbilities,
  type ExpandedManaAbilityInfo,
  type ManaAbilityActionInfo,
} from "@/components/game/manaUtils";
import { manaColorFor } from "../manaColors";
import { getManaSymbolTextureSync, loadManaSymbolTexture } from "../manaSymbolCache";
import { OVERLAY_LABEL_STYLE } from "../textStyles";
import {
  ACTION_BUTTON_ALPHA,
  ACTION_BUTTON_HOVER_ALPHA,
  CARD_RADIUS,
  ICON_BG_ALPHA,
  ICON_HOVER_SCALE,
  MANA_BUTTON_ALPHA,
  MANA_BUTTON_HOVER_ALPHA,
  MANA_BUTTON_STROKE_ALPHA,
  MANA_BUTTON_STROKE_HOVER_ALPHA,
  OVERLAY_LABEL_SELECT,
  OVERLAY_LABEL_TAP,
  OVERLAY_LABEL_UNTAP,
  SELECT_BUTTON_ALPHA,
  SELECT_BUTTON_HOVER_ALPHA,
  SYMBOL_TAP,
  SYMBOL_UNTAP,
} from "../constants";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import type { OverlayHost, SpriteEntry } from "./types";

interface ActionKind {
  isTappable: boolean;
  isUntappable: boolean;
  isSelectable: boolean;
}

/**
 * Builds and wires the per-card action overlay shown on battlefield cards:
 * a single tap/untap/select button, or a grid of mana-ability buttons.
 * Talks to the scene through `OverlayHost`.
 */
export class BattlefieldOverlay {
  private host: OverlayHost;

  constructor(host: OverlayHost) {
    this.host = host;
  }

  /** Resolve a battlefield card tap to the right action (tap land / untap /
   *  open mana picker / select), mirroring the overlay button behaviour. */
  handleCardTap(card: CardDto): void {
    const state = this.host.getLastState();
    if (!state) {
      this.host.getCallbacks().onClickCard?.(card);
      return;
    }

    const kind: ActionKind = {
      isTappable: state.tappableLandIds?.includes(card.id) ?? false,
      isUntappable: state.untappableLandIds?.includes(card.id) ?? false,
      isSelectable: state.selectableCardIds?.includes(card.id) ?? false,
    };

    if (kind.isTappable) {
      const expandedMana = this.manaAbilitiesForCard(card.id, state.manaAbilityOptions);
      if (expandedMana.length > 1) {
        this.host.getCallbacks().onClickCard?.(card);
        return;
      }
      this.dispatchAction(card, state, kind);
      return;
    }

    if (kind.isUntappable) {
      this.dispatchAction(card, state, kind);
      return;
    }

    this.host.getCallbacks().onClickCard?.(card);
  }

  rebuild(entry: SpriteEntry, state: BattlefieldState): void {
    const card = entry.sprite.card;
    const kind: ActionKind = {
      isTappable: state.tappableLandIds?.includes(card.id) ?? false,
      isUntappable: state.untappableLandIds?.includes(card.id) ?? false,
      isSelectable: !!(
        state.selectableCardIds?.includes(card.id) && this.host.getCallbacks().onClickCard
      ),
    };

    if (!kind.isTappable && !kind.isUntappable && !kind.isSelectable) {
      if (entry.overlay) entry.overlay.visible = false;
      return;
    }

    const overlay = this.ensureContainer(entry);
    overlay.removeChildren().forEach((c) => c.destroy({ children: true }));

    const expandedMana = kind.isTappable
      ? this.manaAbilitiesForCard(card.id, state.manaAbilityOptions)
      : [];

    if (kind.isTappable && expandedMana.length > 0) {
      this.drawManaGrid(overlay, card, state, expandedMana);
    } else {
      this.drawSingleButton(overlay, card, state, kind);
    }

    overlay.visible = true;
  }

  private manaAbilitiesForCard(
    cardId: string,
    options: ManaAbilityActionInfo[] | undefined,
  ): ExpandedManaAbilityInfo[] {
    if (!options) return [];
    return getDisplayedManaAbilities(cardId, options);
  }

  refreshAll(): void {
    const state = this.host.getLastState();
    if (!state) return;
    for (const entry of this.host.getEntries().values()) {
      if (entry.overlay?.visible) {
        this.rebuild(entry, state);
      }
    }
  }

  private ensureContainer(entry: SpriteEntry): Container {
    if (entry.overlay) return entry.overlay;
    const overlay = new Container();
    // "passive" — the overlay container itself isn't hit-tested, but child
    // buttons with eventMode "static" can receive pointer events. "none"
    // would disable hit testing for the entire subtree.
    overlay.eventMode = "passive";
    overlay.alpha = 0;
    overlay.pivot.set(CARD_W / 2, CARD_H / 2);
    this.host.getContainer().addChild(overlay);
    entry.overlay = overlay;
    return overlay;
  }

  private drawManaGrid(
    overlay: Container,
    card: CardDto,
    state: BattlefieldState,
    abilities: ExpandedManaAbilityInfo[],
  ): void {
    const entries = abilities.map((ab) => {
      const letters =
        ab.displayManaLetters.length > 0
          ? ab.displayManaLetters
          : extractManaLetters(ab.description);
      return { ab, letters };
    });
    const rows: (typeof entries)[] = [];
    let pending: typeof entries = [];
    for (const entry of entries) {
      if (entry.letters.length > 2) {
        if (pending.length > 0) {
          rows.push(pending);
          pending = [];
        }
        rows.push([entry]);
        continue;
      }
      pending.push(entry);
      if (pending.length === 2) {
        rows.push(pending);
        pending = [];
      }
    }
    if (pending.length > 0) rows.push(pending);

    const btnH = CARD_H / rows.length;

    rows.forEach((rowEntries, rowIndex) => {
      const btnW = CARD_W / rowEntries.length;
      rowEntries.forEach(({ ab, letters }, colIndex) => {
        const x = colIndex * btnW;
        const y = rowIndex * btnH;
        const currentW = rowEntries.length === 1 ? CARD_W : btnW;
        const letter = letters[0];
        const color = manaColorFor(
          letter,
          this.host.getTheme(),
          hexToNum(this.host.getTheme().gameTheme.canvas.shadow),
        );

        const btn = new Graphics();
        const paintBtn = (highlighted: boolean) => {
          btn.clear();
          btn.roundRect(x, y, currentW, btnH, CARD_RADIUS);
          btn.fill({
            color,
            alpha: highlighted ? MANA_BUTTON_HOVER_ALPHA : MANA_BUTTON_ALPHA,
          });
          btn.stroke({
            color: hexToNum(this.host.getTheme().gameTheme.canvas.neutral),
            width: 1,
            alpha: highlighted ? MANA_BUTTON_STROKE_HOVER_ALPHA : MANA_BUTTON_STROKE_ALPHA,
          });
        };
        paintBtn(false);
        overlay.addChild(btn);

        const iconLabels = letters.length > 0 ? letters : [OVERLAY_LABEL_TAP];
        const iconSize = iconLabels.length > 2 ? 8 : rowEntries.length === 2 ? 10 : 12;
        const iconBgSize = iconLabels.length > 2 ? 8 : rowEntries.length === 2 ? 10 : 14;
        const icons = iconLabels.map((iconLabel, iconIndex) => {
          const icon = this.createManaIcon(iconLabel, iconSize, iconBgSize);
          const spacing = iconLabels.length > 2 ? 14 : 18;
          icon.x = x + currentW / 2 + (iconIndex - (iconLabels.length - 1) / 2) * spacing;
          icon.y = y + btnH / 2;
          overlay.addChild(icon);
          return icon;
        });

        this.wireButton(
          btn,
          card.id,
          () => {
            if (entries.length === 1) {
              this.dispatchAction(card, state, {
                isTappable: true,
                isUntappable: false,
                isSelectable: false,
              });
              return;
            }
            if (ab.actionId) {
              this.host.getCallbacks().onTapLandAbility?.(ab.actionId);
            }
          },
          (highlighted) => {
            paintBtn(highlighted);
            icons.forEach((icon) => icon.scale.set(highlighted ? ICON_HOVER_SCALE : 1));
          },
        );
      });
    });
  }

  private drawSingleButton(
    overlay: Container,
    card: CardDto,
    state: BattlefieldState,
    kind: ActionKind,
  ): void {
    const ring = hexToNum(this.host.getTheme().gameTheme.cardRing);
    let label = OVERLAY_LABEL_SELECT;
    let symbol: string | null = null;
    let color = ring;
    let idleAlpha = SELECT_BUTTON_ALPHA;
    let hoverAlpha = SELECT_BUTTON_HOVER_ALPHA;

    if (kind.isTappable) {
      label = OVERLAY_LABEL_TAP;
      symbol = SYMBOL_TAP;
      idleAlpha = ACTION_BUTTON_ALPHA;
      hoverAlpha = ACTION_BUTTON_HOVER_ALPHA;
    } else if (kind.isUntappable) {
      label = OVERLAY_LABEL_UNTAP;
      symbol = SYMBOL_UNTAP;
      color = hexToNum(this.host.getTheme().gameTheme.promptAction.cancel);
      idleAlpha = ACTION_BUTTON_ALPHA;
      hoverAlpha = ACTION_BUTTON_HOVER_ALPHA;
    }

    const btn = new Graphics();
    const paintBtn = (highlighted: boolean) => {
      btn.clear();
      btn.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS);
      btn.fill({ color, alpha: highlighted ? hoverAlpha : idleAlpha });
    };
    paintBtn(false);
    overlay.addChild(btn);

    // Prefer the MTG card symbol (T / Q) when we have one — falls back to
    // the text label for generic SELECT or while the SVG is loading.
    const centerIcon = symbol ? this.createManaIcon(symbol, 14, 18) : this.createLabelIcon(label);
    centerIcon.x = CARD_W / 2;
    centerIcon.y = CARD_H / 2;
    overlay.addChild(centerIcon);

    this.wireButton(
      btn,
      card.id,
      () => this.dispatchAction(card, state, kind),
      (highlighted) => {
        paintBtn(highlighted);
        centerIcon.scale.set(highlighted ? ICON_HOVER_SCALE : 1);
      },
    );
  }

  private createLabelIcon(label: string): Container {
    const icon = new Container();
    icon.eventMode = "none";
    const txt = new Text({ text: label, style: OVERLAY_LABEL_STYLE });
    txt.anchor.set(0.5);
    icon.addChild(txt);
    return icon;
  }

  /**
   * Wires an overlay button's pointer events — tap (with drag-guard), hover
   * feedback, plus keeping the parent card's hover state alive while the
   * cursor is over the button (so the overlay doesn't fade out when the
   * cursor leaves the sprite's hit area to interact with the overlay).
   *
   * The button also forwards `pointerdown` to the sprite's drag-start
   * handler — without this, overlay buttons (which sit above the sprite
   * in the display tree) would swallow the press and the user could
   * never drag an actionable card. If the press turns into a
   * real drag, `pointertap` bails out via the drag-guard.
   */
  private wireButton(
    btn: Graphics,
    cardId: string,
    onTap: () => void,
    onHoverChange?: (highlighted: boolean) => void,
  ): void {
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerover", () => {
      this.host.cancelHoverClear();
      const entry = this.host.getEntries().get(cardId);
      if (entry) this.host.setCardHovered(entry.sprite);
      onHoverChange?.(true);
    });
    btn.on("pointerout", () => {
      onHoverChange?.(false);
      this.host.scheduleHoverClear(cardId);
    });
    btn.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      const entry = this.host.getEntries().get(cardId);
      if (entry) this.host.startCardDrag(entry.sprite, e);
    });
    btn.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (this.host.isJustDragged(cardId)) return;
      onTap();
    });
  }

  private createManaIcon(label: string, fontSize: number, radius: number): Container {
    const icon = new Container();
    // Let pointer events pass through to the button graphic underneath.
    icon.eventMode = "none";
    const circle = new Graphics();
    circle.circle(0, 0, radius);
    circle.fill({
      color: hexToNum(this.host.getTheme().gameTheme.canvas.shadow),
      alpha: ICON_BG_ALPHA,
    });
    icon.addChild(circle);

    const tex = getManaSymbolTextureSync(label);
    if (tex) {
      icon.addChild(this.createManaSprite(tex, radius));
    } else {
      const style = OVERLAY_LABEL_STYLE.clone();
      style.fontSize = fontSize;
      const txt = new Text({ text: label, style });
      txt.anchor.set(0.5);
      icon.addChild(txt);

      if (label.length === 1 && /^[WUBRGCXTQ]$/.test(label)) {
        // Kick off load; next overlay rebuild will pick up the cached texture.
        loadManaSymbolTexture(label)
          .then(() => this.refreshAll())
          .catch(() => {});
      }
    }
    return icon;
  }

  private createManaSprite(texture: Texture, radius: number): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    const size = radius * 1.6;
    sprite.width = size;
    sprite.height = size;
    return sprite;
  }

  private dispatchAction(card: CardDto, state: BattlefieldState, kind: ActionKind): void {
    if (kind.isTappable) {
      const batch = this.selectedBatch(state.tappableLandIds, card.id);
      if (batch.length > 1) this.host.getCallbacks().onTapLands?.(batch);
      else this.host.getCallbacks().onTapLand?.(card);
    } else if (kind.isUntappable) {
      const batch = this.selectedBatch(state.untappableLandIds, card.id);
      if (batch.length > 1) this.host.getCallbacks().onUntapLands?.(batch);
      else this.host.getCallbacks().onUntapLand?.(card);
    } else if (kind.isSelectable) {
      this.host.getCallbacks().onClickCard?.(card);
    }
  }

  private selectedBatch(eligibleIds: string[] | undefined, cardId: string): string[] {
    const selected = this.host.getSelectedCardIds();
    if (!selected.has(cardId) || selected.size <= 1) return [];
    return [...selected].filter((id) => eligibleIds?.includes(id));
  }
}

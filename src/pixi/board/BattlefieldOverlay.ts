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
  OVERLAY_LABEL_UNWATERBEND,
  OVERLAY_LABEL_WATERBEND,
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

const MIN_ICON_SCREEN_PX = 22;

export class BattlefieldOverlay {
  private host: OverlayHost;

  constructor(host: OverlayHost) {
    this.host = host;
  }
  private cardHeight(): number {
    return this.host.isCompact() ? CARD_W : CARD_H;
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
      entry.overlayActive = false;
      if (entry.overlay) entry.overlay.eventMode = "none";
      return;
    }

    const expandedMana = kind.isTappable
      ? this.manaAbilitiesForCard(card.id, state.manaAbilityOptions)
      : [];

    entry.overlayActive = true;
    if (entry.overlay) entry.overlay.eventMode = "passive";
    const sig = JSON.stringify([
      kind.isTappable,
      kind.isUntappable,
      kind.isSelectable,
      state.waterbendSourceIds?.includes(card.id) ?? false,
      state.waterbentCardIds?.includes(card.id) ?? false,
      this.host.isCompact(),
      expandedMana.map((ab) => [
        ab.actionId,
        ab.description,
        ab.displayManaLetters,
        ab.colorChoice,
      ]),
    ]);
    if (entry.overlay && entry.overlaySig === sig) return;
    entry.overlaySig = sig;

    const overlay = this.ensureContainer(entry);
    overlay.pivot.set(CARD_W / 2, this.cardHeight() / 2);
    overlay.removeChildren().forEach((c) => c.destroy({ children: true }));

    if (kind.isTappable && expandedMana.length > 0 && !this.host.isCompact()) {
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
      if (entry.overlay) {
        entry.overlaySig = undefined;
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
        const controlX = x + 2;
        const controlH = Math.min(40, btnH - 4);
        const controlY = y + (btnH - controlH) / 2;
        const controlW = currentW - 4;
        const letter = letters[0];
        const color = manaColorFor(
          letter,
          this.host.getTheme(),
          hexToNum(this.host.getTheme().gameTheme.canvas.shadow),
        );

        const btn = new Graphics();
        const paintBtn = (highlighted: boolean) => {
          btn.clear();
          btn.roundRect(
            controlX,
            controlY,
            controlW,
            controlH,
            Math.min(CARD_RADIUS, controlH / 2),
          );
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
          icon.x = controlX + controlW / 2 + (iconIndex - (iconLabels.length - 1) / 2) * spacing;
          icon.y = controlY + controlH / 2;
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

    const live = this.host.getLastState() ?? state;
    const isWaterbend =
      (live.waterbendSourceIds?.includes(card.id) ?? false) &&
      this.manaAbilitiesForCard(card.id, live.manaAbilityOptions).length === 0;
    const isWaterbent = live.waterbentCardIds?.includes(card.id) ?? false;

    if (kind.isTappable) {
      label = isWaterbend ? OVERLAY_LABEL_WATERBEND : OVERLAY_LABEL_TAP;
      symbol = isWaterbend ? null : SYMBOL_TAP;
      idleAlpha = ACTION_BUTTON_ALPHA;
      hoverAlpha = ACTION_BUTTON_HOVER_ALPHA;
    } else if (kind.isUntappable) {
      label = isWaterbent ? OVERLAY_LABEL_UNWATERBEND : OVERLAY_LABEL_UNTAP;
      symbol = isWaterbent ? null : SYMBOL_UNTAP;
      color = hexToNum(this.host.getTheme().gameTheme.interaction.untap);
      idleAlpha = ACTION_BUTTON_ALPHA;
      hoverAlpha = ACTION_BUTTON_HOVER_ALPHA;
    }
    const selectionOnly = kind.isSelectable && !kind.isTappable && !kind.isUntappable;
    const controlX = selectionOnly ? 0 : 6;
    const cardHeight = this.cardHeight();
    const controlY = selectionOnly ? 0 : (cardHeight - 40) / 2;
    const controlW = selectionOnly ? CARD_W : CARD_W - 12;
    const controlH = selectionOnly ? cardHeight : 40;

    const btn = new Graphics();
    const paintBtn = (highlighted: boolean) => {
      btn.clear();
      btn.roundRect(controlX, controlY, controlW, controlH, Math.min(CARD_RADIUS, controlH / 2));
      btn.fill({ color, alpha: highlighted ? hoverAlpha : idleAlpha });
    };
    paintBtn(false);
    overlay.addChild(btn);

    // Prefer the MTG card symbol (T / Q) when we have one — falls back to
    // the text label for generic SELECT or while the SVG is loading.
    const centerIcon = symbol ? this.createManaIcon(symbol, 14, 18) : this.createLabelIcon(label);
    centerIcon.x = controlX + controlW / 2;
    centerIcon.y = controlY + controlH / 2;
    const iconScale = Math.min(
      CARD_W / (2 * 18 + 4),
      Math.max(1, MIN_ICON_SCREEN_PX / (2 * 18 * this.host.getCardScale())),
    );
    centerIcon.scale.set(iconScale);
    overlay.addChild(centerIcon);

    this.wireButton(
      btn,
      card.id,
      () => this.dispatchAction(card, state, kind),
      (highlighted) => {
        paintBtn(highlighted);
        centerIcon.scale.set(iconScale * (highlighted ? ICON_HOVER_SCALE : 1));
      },
      selectionOnly,
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

  private wireButton(
    btn: Graphics,
    cardId: string,
    onTap: () => void,
    onHoverChange?: (highlighted: boolean) => void,
    forwardCardPress = false,
  ): void {
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerover", (e: FederatedPointerEvent) => {
      if (e.pointerType === "touch") return;
      this.host.cancelHoverClear();
      const entry = this.host.getEntries().get(cardId);
      if (entry) this.host.setCardHovered(entry.sprite, false, e);
      onHoverChange?.(true);
    });
    btn.on("pointermove", (e: FederatedPointerEvent) => {
      if (e.pointerType === "touch") return;
      const entry = this.host.getEntries().get(cardId);
      if (entry) this.host.setCardHovered(entry.sprite, true, e);
    });
    btn.on("pointerout", () => {
      onHoverChange?.(false);
      this.host.scheduleHoverClear(cardId);
    });
    btn.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      if (forwardCardPress) {
        const entry = this.host.getEntries().get(cardId);
        if (entry) this.host.startCardPress(entry.sprite, e);
      }
    });
    btn.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0 || this.host.consumeCardTap(cardId)) return;
      onTap();
    });
    btn.on("rightclick", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      const entry = this.host.getEntries().get(cardId);
      if (entry) this.host.rightClickCard(entry.sprite);
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
    // Buttons can outlive the state they were built from (unchanged specs skip
    // the rebuild), so batch eligibility reads the live state at tap time.
    const live = this.host.getLastState() ?? state;
    if (kind.isTappable) {
      const batch = this.selectedBatch(live.tappableLandIds, card.id);
      if (batch.length > 1) this.host.getCallbacks().onTapLands?.(batch);
      else this.host.getCallbacks().onTapLand?.(card);
    } else if (kind.isUntappable) {
      const batch = this.selectedBatch(live.untappableLandIds, card.id);
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

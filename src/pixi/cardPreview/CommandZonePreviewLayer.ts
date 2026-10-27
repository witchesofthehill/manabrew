import { getUiControlHeight, getUiFontSize, UI_FONT_FAMILY } from "@/themes/typography";
import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
} from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { ClientCardDto } from "@/stores/gameStore.types";
import { usePreferencesStore, type InGameCardPreviewStyle } from "@/stores/usePreferencesStore";
import { CARD_H, CARD_W } from "@/components/game/game.constants";
import { computePreviewCardDimensions } from "@/components/game/cardPreviewLayout";
import { CardSprite } from "@/pixi/CardSprite";
import { getSafeAreaInsets } from "@/lib/safeArea";
import { hexToNum } from "@/pixi/colorUtils";
import { gsap } from "@/pixi/effects/gsap";
import { gameCardFaceIndex } from "@/lib/gameCard";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { PREVIEW_TIMING } from "@/lib/cardPreview";
import { applyIcon } from "@/pixi/panelIcons";
import type { GamePreviewFlipBinding } from "@/hooks/useGamePreviewFlip";
import { PreviewFlipAnimation } from "@/pixi/cardPreview/PreviewFlipAnimation";

export interface CommandZonePreviewLayerSpec {
  cards: ClientCardDto[];
  castableCardIds: string[];
  style: InGameCardPreviewStyle;
  phase: "open" | "closing";
  suppressed: boolean;
  anchor: { x: number; y: number; width: number; height: number };
  viewportRight?: number;
  showBackFace?: boolean;
  flip?: GamePreviewFlipBinding;
}

interface PreviewEntry {
  sprite: CardSprite;
  bounds: Rectangle;
  castButton: Container;
  castButtonBackground: Graphics;
  castButtonIcon: Sprite;
  castButtonLabel: Text;
  face: 0 | 1 | null;
}

interface CommandZonePreviewLayerCallbacks {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onInteractionReady: () => void;
  onCastCard: (cardId: string) => void;
  onRenderRequested: () => void;
  onFlip: () => void;
  onToggleView: () => void;
}

const PREVIEW_GAP = 12;
const EDGE_PAD = 8;
const ANCHOR_GAP = 12;
const INTERACTION_PAD_MS = 80;
const CAST_BUTTON_WIDTH = 54;
const CAST_BUTTON_INSET = 5;
const CAST_BUTTON_RADIUS = 7;
const CAST_BUTTON_ICON_SIZE = 12;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export class CommandZonePreviewLayer {
  readonly container = new Container();
  private theme: Theme;
  private callbacks: CommandZonePreviewLayerCallbacks;
  private spec: CommandZonePreviewLayerSpec | null = null;
  private entries: PreviewEntry[] = [];
  private viewportWidth = 0;
  private viewportHeight = 0;
  private groupWidth = 0;
  private groupHeight = 0;
  private pointerInside = false;
  private hoveredIndex = -1;
  private interactiveReady = false;
  private interactionTimer: number | null = null;
  private previewSize = usePreferencesStore.getState().inGameCardPreviewSize;
  private readonly unsubscribePreferences: () => void;
  private layoutX = 0;
  private readonly flip = new PreviewFlipAnimation(
    (scale) => {
      this.container.scale.set(scale, 1);
      this.container.x = this.layoutX + (this.groupWidth * (1 - scale)) / 2;
      this.callbacks.onRenderRequested();
    },
    () =>
      this.entries.length > 0 &&
      this.entries.every((entry) => entry.sprite.previewPresentationReady),
  );

  constructor(theme: Theme, callbacks: CommandZonePreviewLayerCallbacks) {
    this.theme = theme;
    this.callbacks = callbacks;
    this.container.visible = false;
    this.container.eventMode = "passive";
    this.unsubscribePreferences = usePreferencesStore.subscribe((state, previous) => {
      if (state.inGameCardPreviewSize === previous.inGameCardPreviewSize) return;
      this.previewSize = state.inGameCardPreviewSize;
      if (!this.spec || this.spec.phase !== "open") return;
      gsap.killTweensOf(this.container);
      this.layout();
      this.callbacks.onRenderRequested();
    });
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    for (const entry of this.entries) this.paintCastButton(entry, false);
    this.layout();
    this.setHoveredIndex(this.hoveredIndex, true);
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.layout();
  }

  setSpec(spec: CommandZonePreviewLayerSpec | null): void {
    const previous = this.spec;
    if (previous?.flip?.handleRef !== spec?.flip?.handleRef && previous?.flip) {
      previous.flip.handleRef.current = null;
    }
    this.spec = spec;
    if (spec?.flip) {
      spec.flip.handleRef.current = this.flip;
      if (spec.flip.closed && !previous?.flip?.closed) this.flip.setClosed();
    }
    const sameCards =
      spec?.cards.length === this.entries.length &&
      spec.cards.every((card, index) => this.entries[index]?.sprite.card.id === card.id);
    if (!sameCards) this.rebuild(spec?.cards ?? []);
    else if (spec) {
      spec.cards.forEach((card, index) => {
        this.entries[index]!.sprite.updateCardContent(card);
      });
    }
    if (spec) {
      for (const entry of this.entries) {
        const card = entry.sprite.card;
        const castable = spec.castableCardIds.includes(card.id);
        entry.sprite.setHandRulesView(spec.style === "rules");
        if (this.entries.length === 1 && spec.showBackFace != null) {
          entry.sprite.setPreviewFace(spec.showBackFace ? 1 : 0, false);
        }
        entry.sprite.setHandControls({
          rulesView: spec.style === "rules",
          horizontal: entry.sprite.horizontalFrame && !card.isDoubleFaced,
          alternateFace: entry.face === 1,
          showFaceControl: card.isDoubleFaced,
          onToggleRules: () => this.callbacks.onToggleView(),
          onToggleFace: () => this.flipEntry(entry),
        });
        entry.sprite.setHandRulesActions(
          castable ? [{ kind: "cast", cardId: card.id, label: `Cast ${card.identity.name}` }] : [],
          (action) => this.callbacks.onCastCard(action.cardId),
        );
        entry.castButton.visible = castable && spec.style !== "rules";
      }
    }
    this.layout();
    if (spec?.phase === "open" && !spec.suppressed) {
      if (!previous || previous.phase !== "open" || previous.suppressed) {
        if (spec.flip?.closed) this.showImmediately();
        else this.animateIn(previous == null);
      } else {
        this.container.visible = true;
      }
    } else if (spec?.phase === "closing" && previous && !previous.suppressed) {
      this.animateOut();
    } else {
      this.hide();
    }
    if (this.flip.isReady()) spec?.flip?.onReady();
  }

  hitTest(x: number, y: number): boolean {
    if (!this.container.visible || !this.interactiveReady) return false;
    const localX = x - this.container.x;
    const localY = y - this.container.y;
    return localX >= 0 && localX <= this.groupWidth && localY >= 0 && localY <= this.groupHeight;
  }

  hitTestRules(x: number, y: number): boolean {
    return this.spec?.style === "rules" && this.hitTest(x, y);
  }

  scrollRulesAt(x: number, y: number, delta: number, mode: number): void {
    if (!this.hitTestRules(x, y)) return;
    const localX = x - this.container.x;
    const localY = y - this.container.y;
    const entry = this.entries.find((entry) => entry.bounds.contains(localX, localY));
    if (entry?.sprite.scrollHandRules(delta, mode, x, y)) this.callbacks.onRenderRequested();
  }

  updateHover(x: number, y: number): boolean {
    const inside = this.hitTest(x, y);
    if (inside && !this.pointerInside) {
      this.pointerInside = true;
      this.callbacks.onPointerEnter();
    } else if (!inside && this.pointerInside) {
      this.pointerInside = false;
      this.callbacks.onPointerLeave();
    }
    if (!inside) {
      this.setHoveredIndex(-1);
      return false;
    }
    const localX = x - this.container.x;
    const localY = y - this.container.y;
    let hovered = -1;
    for (let index = this.entries.length - 1; index >= 0; index--) {
      if (this.entries[index]!.bounds.contains(localX, localY)) {
        hovered = index;
        break;
      }
    }
    this.setHoveredIndex(hovered);
    return true;
  }

  clearHover(): void {
    if (this.pointerInside) this.callbacks.onPointerLeave();
    this.pointerInside = false;
    this.setHoveredIndex(-1);
  }
  activatePrimaryTransform(): void {
    const entry =
      this.entries[this.hoveredIndex] ?? (this.entries.length === 1 ? this.entries[0] : null);
    if (entry?.sprite.card.isDoubleFaced) this.flipEntry(entry);
  }

  private flipEntry(entry: PreviewEntry): void {
    if (this.entries.length === 1) {
      this.callbacks.onFlip();
      return;
    }
    entry.face = (entry.face ?? gameCardFaceIndex(entry.sprite.card)) === 0 ? 1 : 0;
    entry.sprite.setPreviewFace(entry.face);
  }

  destroy(): void {
    this.unsubscribePreferences();
    if (this.spec?.flip) this.spec.flip.handleRef.current = null;
    this.flip.cancel();
    this.clearInteractionTimer();
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    for (const entry of this.entries) {
      entry.sprite.destroy();
      entry.castButton.destroy({ children: true });
    }
    this.entries = [];
    this.container.destroy();
  }

  private rebuild(cards: ClientCardDto[]): void {
    for (const entry of this.entries) {
      entry.sprite.destroy();
      entry.castButton.destroy({ children: true });
    }
    this.entries = cards.map((card) => {
      const sprite = new CardSprite(card, "hand");
      sprite.onVisualChange = () => {
        this.callbacks.onRenderRequested();
        if (this.flip.isReady()) this.spec?.flip?.onReady();
      };
      const castButton = new Container();
      const castButtonBackground = new Graphics();
      const castButtonIcon = new Sprite(Texture.EMPTY);
      const castButtonLabel = new Text({
        text: "Cast",
        style: {
          fill: hexToNum(this.theme.appTheme["popover-foreground"]),
          fontFamily: UI_FONT_FAMILY,
          fontSize: getUiFontSize("label"),
          fontWeight: "700",
        },
      });
      castButtonIcon.anchor.set(0.5);
      applyIcon(
        castButtonIcon,
        "card-play",
        this.theme.appTheme["popover-foreground"],
        undefined,
        CAST_BUTTON_ICON_SIZE,
        CAST_BUTTON_ICON_SIZE,
      );
      castButtonLabel.anchor.set(0.5);
      castButton.eventMode = "static";
      castButton.cursor = "pointer";
      castButton.hitArea = new Rectangle();
      castButton.addChild(castButtonBackground, castButtonIcon, castButtonLabel);
      const entry: PreviewEntry = {
        sprite,
        bounds: new Rectangle(),
        castButton,
        castButtonBackground,
        castButtonIcon,
        castButtonLabel,
        face: null,
      };
      castButton.on("pointerenter", (event: FederatedPointerEvent) => {
        if (event.pointerType !== "touch") this.paintCastButton(entry, true);
      });
      castButton.on("pointerleave", () => this.paintCastButton(entry, false));
      castButton.on("pointerdown", (event: FederatedPointerEvent) => event.stopPropagation());
      castButton.on("pointertap", (event: FederatedPointerEvent) => {
        event.stopPropagation();
        this.callbacks.onCastCard(card.id);
      });
      this.paintCastButton(entry, false);
      sprite.onReorient = () => this.layout();
      this.container.addChild(sprite, castButton);
      return entry;
    });
  }

  private layout(): void {
    const spec = this.spec;
    if (!spec || this.entries.length === 0 || this.viewportWidth <= 0 || this.viewportHeight <= 0)
      return;
    const safe = getSafeAreaInsets();
    const viewportLeft = safe.left;
    const viewportTop = safe.top;
    const viewportBottom = this.viewportHeight - safe.bottom;
    const viewportRight = Math.min(
      this.viewportWidth - safe.right,
      spec.viewportRight ?? this.viewportWidth,
    );
    const baseWidths = this.entries.map((entry) =>
      entry.sprite.horizontalFrame ? CARD_H : CARD_W,
    );
    const baseHeights = this.entries.map((entry) =>
      entry.sprite.horizontalFrame ? CARD_W : CARD_H,
    );
    const maxBaseHeight = Math.max(...baseHeights);
    const idealScale = Math.min(
      ...this.entries.map((entry, index) => {
        const dimensions = computePreviewCardDimensions({
          usableWidth: viewportRight - viewportLeft,
          usableHeight: viewportBottom - viewportTop,
          horizontal: entry.sprite.horizontalFrame,
          size: this.previewSize,
        });
        return dimensions.width / baseWidths[index]!;
      }),
    );
    const widthWithoutGaps = baseWidths.reduce((sum, width) => sum + width, 0);
    const availableWidth = Math.max(1, viewportRight - viewportLeft - EDGE_PAD * 2);
    const scale = Math.max(
      0.1,
      Math.min(
        idealScale,
        (availableWidth - PREVIEW_GAP * (this.entries.length - 1)) / widthWithoutGaps,
      ),
    );
    let x = 0;
    this.groupHeight = maxBaseHeight * scale;
    this.entries.forEach((entry, index) => {
      const width = baseWidths[index]! * scale;
      const height = baseHeights[index]! * scale;
      const y = (this.groupHeight - height) / 2;
      entry.bounds.set(x, y, width, height);
      entry.sprite.position.set(x + width / 2, y + height / 2);
      entry.sprite.scale.set(scale);
      entry.sprite.setHandRulesScale(scale);
      entry.sprite.setChromeScale(1 / scale);
      entry.castButton.position.set(
        x + width - this.castButtonWidth(entry) - CAST_BUTTON_INSET,
        y + CAST_BUTTON_INSET,
      );
      x += width + PREVIEW_GAP;
    });
    this.groupWidth = x - PREVIEW_GAP;
    const right = spec.anchor.x + spec.anchor.width + ANCHOR_GAP;
    const left = spec.anchor.x - this.groupWidth - ANCHOR_GAP;
    const targetX =
      right + this.groupWidth <= viewportRight - EDGE_PAD
        ? right
        : left >= viewportLeft + EDGE_PAD
          ? left
          : spec.anchor.x + spec.anchor.width / 2 - this.groupWidth / 2;
    this.container.x = Math.max(
      viewportLeft + EDGE_PAD,
      Math.min(targetX, viewportRight - EDGE_PAD - this.groupWidth),
    );
    const targetY = spec.anchor.y + spec.anchor.height / 2 - this.groupHeight / 2;
    this.container.y = Math.max(
      viewportTop + EDGE_PAD,
      Math.min(targetY, viewportBottom - EDGE_PAD - this.groupHeight),
    );
    this.layoutX = this.container.x;
    this.container.x += (this.groupWidth * (1 - this.flip.scale)) / 2;
    this.container.scale.x = this.flip.scale;
  }

  private animateIn(fromHidden: boolean): void {
    const spec = this.spec;
    if (!spec) return;
    this.container.visible = true;
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    if (!fromHidden || !animationsEnabled() || prefersReducedMotion()) {
      this.showImmediately();
      return;
    }
    const finalX = this.container.x;
    const finalY = this.container.y;
    const anchorCenterX = spec.anchor.x + spec.anchor.width / 2;
    const anchorCenterY = spec.anchor.y + spec.anchor.height / 2;
    const startScale = Math.max(0.25, Math.min(0.85, spec.anchor.width / this.groupWidth));
    this.armInteraction();
    gsap.fromTo(
      this.container,
      { x: anchorCenterX, y: anchorCenterY, alpha: 0 },
      {
        x: finalX,
        y: finalY,
        alpha: 1,
        duration: PREVIEW_TIMING.enterMs / 1000,
        ease: "power3.out",
      },
    );
    gsap.fromTo(
      this.container.scale,
      { x: startScale, y: startScale },
      {
        x: 1,
        y: 1,
        duration: PREVIEW_TIMING.enterMs / 1000,
        ease: "power3.out",
      },
    );
  }

  private animateOut(): void {
    const spec = this.spec;
    if (!spec) return;
    this.interactiveReady = false;
    this.clearInteractionTimer();
    this.clearHover();
    if (!animationsEnabled() || prefersReducedMotion()) {
      this.hide();
      return;
    }
    const anchorCenterX = spec.anchor.x + spec.anchor.width / 2;
    const anchorCenterY = spec.anchor.y + spec.anchor.height / 2;
    gsap.to(this.container, {
      x: anchorCenterX,
      y: anchorCenterY,
      alpha: 0,
      duration: PREVIEW_TIMING.exitMs / 1000,
      ease: "power2.in",
    });
    gsap.to(this.container.scale, {
      x: Math.max(0.25, this.container.scale.x * 0.55),
      y: Math.max(0.25, this.container.scale.y * 0.55),
      duration: PREVIEW_TIMING.exitMs / 1000,
      ease: "power2.in",
    });
  }

  private showImmediately(): void {
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    this.clearInteractionTimer();
    this.container.visible = true;
    this.container.alpha = 1;
    this.container.scale.set(this.flip.scale, 1);
    this.interactiveReady = true;
    this.callbacks.onInteractionReady();
  }

  private armInteraction(): void {
    this.interactiveReady = false;
    this.clearInteractionTimer();
    this.interactionTimer = window.setTimeout(() => {
      this.interactionTimer = null;
      if (this.spec?.phase === "open" && !this.spec.suppressed) {
        this.interactiveReady = true;
        this.callbacks.onInteractionReady();
      }
    }, PREVIEW_TIMING.enterMs + INTERACTION_PAD_MS);
  }

  private hide(): void {
    gsap.killTweensOf(this.container);
    this.flip.cancel();
    gsap.killTweensOf(this.container.scale);
    this.clearInteractionTimer();
    this.clearHover();
    this.interactiveReady = false;
    this.container.visible = false;
    this.container.alpha = 1;
    this.container.scale.set(1);
  }

  private clearInteractionTimer(): void {
    if (this.interactionTimer === null) return;
    window.clearTimeout(this.interactionTimer);
    this.interactionTimer = null;
  }

  private castButtonWidth(entry: PreviewEntry): number {
    return Math.max(
      CAST_BUTTON_WIDTH,
      getUiControlHeight(),
      entry.castButtonLabel.width + CAST_BUTTON_ICON_SIZE + 24,
    );
  }

  private paintCastButton(entry: PreviewEntry, hovered: boolean): void {
    const foreground = hovered
      ? this.theme.appTheme["primary-foreground"]
      : this.theme.appTheme["popover-foreground"];
    entry.castButtonLabel.style.fontSize = getUiFontSize("label");
    const width = this.castButtonWidth(entry);
    const height = Math.max(getUiControlHeight(), entry.castButtonLabel.height + 12);
    entry.castButtonIcon.position.set(13, height / 2);
    entry.castButtonLabel.position.set(
      CAST_BUTTON_ICON_SIZE + 16 + entry.castButtonLabel.width / 2,
      height / 2,
    );
    (entry.castButton.hitArea as Rectangle).set(0, 0, width, height);
    entry.castButtonBackground
      .clear()
      .roundRect(0, 0, width, height, CAST_BUTTON_RADIUS)
      .fill({
        color: hexToNum(hovered ? this.theme.appTheme.primary : this.theme.appTheme.popover),
        alpha: hovered ? 1 : 0.96,
      })
      .stroke({
        color: hexToNum(hovered ? this.theme.appTheme.primary : this.theme.appTheme.border),
        width: hovered ? 1.5 : 0.75,
      });
    entry.castButton.alpha = hovered ? 1 : 0.9;
    entry.castButtonIcon.tint = hexToNum(foreground);
    entry.castButtonLabel.style.fill = hexToNum(foreground);
  }

  private setHoveredIndex(index: number, force = false): void {
    if (!force && this.hoveredIndex === index) return;
    this.hoveredIndex = index;
    const ring = hexToNum(this.theme.gameTheme.cardRing);
    this.entries.forEach((entry, entryIndex) => {
      entry.sprite.setRing(entryIndex === index ? ring : null);
    });
  }
}

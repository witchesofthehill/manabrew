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
import type { InGameCardPreviewStyle } from "@/stores/usePreferencesStore";
import { CARD_H, CARD_W, GAME_CARD_SIZES } from "@/components/game/game.constants";
import { CardSprite } from "@/pixi/CardSprite";
import { hexToNum } from "@/pixi/colorUtils";
import { gsap } from "@/pixi/effects/gsap";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { PREVIEW_TIMING } from "@/lib/cardPreview";
import { applyIcon } from "@/pixi/panelIcons";

export interface CommandZonePreviewLayerSpec {
  cards: ClientCardDto[];
  castableCardIds: string[];
  style: InGameCardPreviewStyle;
  phase: "open" | "closing";
  suppressed: boolean;
  anchor: { x: number; y: number; width: number; height: number };
  viewportRight?: number;
}

interface PreviewEntry {
  sprite: CardSprite;
  bounds: Rectangle;
  castButton: Container;
  castButtonBackground: Graphics;
  castButtonIcon: Sprite;
  castButtonLabel: Text;
}

interface CommandZonePreviewLayerCallbacks {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onInteractionReady: () => void;
  onCastCard: (cardId: string) => void;
}

const PREVIEW_GAP = 12;
const EDGE_PAD = 8;
const ANCHOR_GAP = 12;
const INTERACTION_PAD_MS = 80;
const CAST_BUTTON_WIDTH = 54;
const CAST_BUTTON_HEIGHT = 22;
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

  constructor(theme: Theme, callbacks: CommandZonePreviewLayerCallbacks) {
    this.theme = theme;
    this.callbacks = callbacks;
    this.container.visible = false;
    this.container.eventMode = "passive";
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    for (const entry of this.entries) this.paintCastButton(entry, false);
    this.setHoveredIndex(this.hoveredIndex, true);
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.layout();
  }

  setSpec(spec: CommandZonePreviewLayerSpec | null): void {
    const previous = this.spec;
    this.spec = spec;
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
        entry.sprite.setHandRulesView(spec.style === "rules");
      }
      for (const entry of this.entries) {
        entry.castButton.visible = spec.castableCardIds.includes(entry.sprite.card.id);
      }
    }
    this.layout();
    if (spec?.phase === "open" && !spec.suppressed) {
      if (!previous || previous.phase !== "open" || previous.suppressed) {
        this.animateIn(previous == null);
      } else {
        this.container.visible = true;
      }
    } else if (spec?.phase === "closing" && previous && !previous.suppressed) {
      this.animateOut();
    } else {
      this.hide();
    }
  }

  hitTest(x: number, y: number): boolean {
    if (!this.container.visible || !this.interactiveReady) return false;
    const localX = x - this.container.x;
    const localY = y - this.container.y;
    return localX >= 0 && localX <= this.groupWidth && localY >= 0 && localY <= this.groupHeight;
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

  destroy(): void {
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
      const castButton = new Container();
      const castButtonBackground = new Graphics();
      const castButtonIcon = new Sprite(Texture.EMPTY);
      const castButtonLabel = new Text({
        text: "Cast",
        style: {
          fill: hexToNum(this.theme.appTheme["popover-foreground"]),
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 10,
          fontWeight: "700",
        },
      });
      castButtonIcon.anchor.set(0.5);
      castButtonIcon.position.set(13, CAST_BUTTON_HEIGHT / 2);
      applyIcon(
        castButtonIcon,
        "card-play",
        this.theme.appTheme["popover-foreground"],
        undefined,
        CAST_BUTTON_ICON_SIZE,
        CAST_BUTTON_ICON_SIZE,
      );
      castButtonLabel.anchor.set(0.5);
      castButtonLabel.position.set(37, CAST_BUTTON_HEIGHT / 2);
      castButton.eventMode = "static";
      castButton.cursor = "pointer";
      castButton.hitArea = new Rectangle(0, 0, CAST_BUTTON_WIDTH, CAST_BUTTON_HEIGHT);
      castButton.addChild(castButtonBackground, castButtonIcon, castButtonLabel);
      const entry: PreviewEntry = {
        sprite,
        bounds: new Rectangle(),
        castButton,
        castButtonBackground,
        castButtonIcon,
        castButtonLabel,
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
    const viewportRight = Math.min(this.viewportWidth, spec.viewportRight ?? this.viewportWidth);
    const baseWidths = this.entries.map((entry) =>
      entry.sprite.horizontalFrame ? CARD_H : CARD_W,
    );
    const baseHeights = this.entries.map((entry) =>
      entry.sprite.horizontalFrame ? CARD_W : CARD_H,
    );
    const maxBaseHeight = Math.max(...baseHeights);
    const idealScale = Math.min(
      GAME_CARD_SIZES.preview.width / CARD_W,
      (this.viewportHeight - EDGE_PAD * 2) / maxBaseHeight,
    );
    const widthWithoutGaps = baseWidths.reduce((sum, width) => sum + width, 0);
    const availableWidth = Math.max(1, viewportRight - EDGE_PAD * 2);
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
      entry.sprite.setChromeScale(1 / scale);
      entry.castButton.position.set(
        x + width - CAST_BUTTON_WIDTH - CAST_BUTTON_INSET,
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
        : left >= EDGE_PAD
          ? left
          : spec.anchor.x + spec.anchor.width / 2 - this.groupWidth / 2;
    this.container.x = Math.max(
      EDGE_PAD,
      Math.min(targetX, viewportRight - EDGE_PAD - this.groupWidth),
    );
    const targetY = spec.anchor.y + spec.anchor.height / 2 - this.groupHeight / 2;
    this.container.y = Math.max(
      EDGE_PAD,
      Math.min(targetY, this.viewportHeight - EDGE_PAD - this.groupHeight),
    );
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
    this.container.scale.set(1);
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

  private paintCastButton(entry: PreviewEntry, hovered: boolean): void {
    const foreground = hovered
      ? this.theme.gameTheme.textOnTinted
      : this.theme.appTheme["popover-foreground"];
    entry.castButtonBackground
      .clear()
      .roundRect(0, 0, CAST_BUTTON_WIDTH, CAST_BUTTON_HEIGHT, CAST_BUTTON_RADIUS)
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

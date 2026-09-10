import { Application, Container, Graphics } from "pixi.js";
import { CARD_H, CARD_RADIUS, CARD_W, GAME_CARD_SIZES } from "@/components/game/game.constants";
import type { CardInspectionState } from "@/components/game/modals/cardInspection";
import type { CardBrowserItem } from "@/components/game/modals/cardBrowser";
import { isFacelessCard } from "@/lib/gameCard";
import { CardSprite } from "@/pixi/CardSprite";
import { hexToNum } from "@/pixi/colorUtils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import { OverlayRenderScheduler, overlayResolution } from "@/pixi/overlay/overlayRuntime";
import { rulesCardRadius } from "@/pixi/cardPreview/rulesPreviewFrame";
import { destroyPixiApp } from "@/pixi/pixiPatches";
import { useScryfallStore } from "@/stores/useScryfallStore";

export interface ZoneBrowserSceneProps {
  items: CardBrowserItem[];
  activeId: string | null;
  inspection: Record<string, CardInspectionState>;
  defaultRules: boolean;
  pending: boolean;
  ringColor: string;
  width: number;
  height: number;
  onActive: (id: string) => void;
  onChange: (item: CardBrowserItem, state: CardInspectionState) => void;
}

interface CardEntry {
  item: CardBrowserItem;
  container: Container;
  sprite: CardSprite;
  feedback: Graphics;
  viewKey: string;
  feedbackWidth: number;
  feedbackHeight: number;
  feedbackColor: number;
  feedbackStroke: number;
  feedbackRadius: number;
  fresh: boolean;
  motion: {
    x: number;
    y: number;
    scale: number;
    elevation: number;
    ringAlpha: number;
  };
}

export const ZONE_BROWSER_RIBBON_MOTION = {
  reveal: 78,
  minReveal: 54,
  focusSpread: 48,
  focusLift: 20,
  focusScale: 0.035,
  dragThreshold: 6,
  wheelPixelsPerCard: 150,
  wheelSnapMs: 90,
  wheelDuration: 0.22,
  snapDuration: 0.32,
  layoutDuration: 0.38,
  entryDuration: 0.22,
  feedbackDuration: 0.16,
  elevationDuration: 0.18,
} as const;

const VIEWPORT_PADDING = 24;

export class ZoneBrowserScene {
  private readonly app = new Application();
  private readonly entries = new Map<string, CardEntry>();
  private readonly canvas: HTMLCanvasElement;
  private readonly onError: (error: string) => void;
  private props: ZoneBrowserSceneProps;
  private scheduler: OverlayRenderScheduler | null = null;
  private unsubscribe: (() => void) | null = null;
  private initialized = false;
  private disposed = false;
  private activeUntil = 0;
  private hoveredId: string | null = null;
  private internalActiveId: string | null = null;
  private scrollTarget = 0;
  private readonly scrollMotion = { value: 0 };
  private scrolling = false;
  private wheelTimer: number | undefined;
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartScroll = 0;
  private dragged = false;
  private suppressTapUntil = 0;

  constructor(
    canvas: HTMLCanvasElement,
    props: ZoneBrowserSceneProps,
    onError: (error: string) => void,
  ) {
    this.canvas = canvas;
    this.props = props;
    this.onError = onError;
  }

  async init(): Promise<void> {
    try {
      await this.app.init({
        canvas: this.canvas,
        width: Math.max(1, this.props.width),
        height: Math.max(1, this.props.height),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        autoStart: false,
        resolution: overlayResolution(this.props.width, this.props.height),
        eventFeatures: { wheel: false },
      });
      this.app.renderer.events.autoPreventDefault = false;
      this.initialized = true;
      if (this.disposed) {
        destroyPixiApp(this.app);
        return;
      }
      this.app.stage.eventMode = "static";
      this.app.stage.sortableChildren = true;
      this.scheduler = new OverlayRenderScheduler(this.app, () =>
        [...this.entries.values()].some(
          ({ sprite, item }) =>
            !sprite.imageSettled ||
            performance.now() < this.activeUntil ||
            (animationsEnabled() && item.card.foil),
        ),
      );
      this.unsubscribe = useScryfallStore.subscribe(this.request);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("pointerup", this.onPointerUp);
      this.canvas.addEventListener("pointercancel", this.onPointerUp);
      this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
      this.update(this.props);
    } catch (cause) {
      if (!this.disposed) this.onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  update(props: ZoneBrowserSceneProps): void {
    const previousActiveId = this.props.activeId;
    this.props = props;
    if (!this.initialized || this.disposed) return;
    const width = Math.max(1, props.width);
    const height = Math.max(1, props.height);
    if (this.app.screen.width !== width || this.app.screen.height !== height) {
      this.app.renderer.resize(width, height);
    }
    this.scrollTarget = this.clampScroll(this.scrollTarget);
    this.scrollMotion.value = this.clampScroll(this.scrollMotion.value);
    const activeIndex = props.items.findIndex((item) => item.id === props.activeId);
    if (props.activeId !== previousActiveId && activeIndex >= 0) {
      if (this.internalActiveId === props.activeId) {
        this.internalActiveId = null;
      } else {
        this.hoveredId = null;
        this.scrollTo(activeIndex);
        return;
      }
    }
    if (props.items.length && !this.entries.size) {
      const start = activeIndex >= 0 ? activeIndex : 0;
      this.scrollTarget = start;
      this.scrollMotion.value = start;
    }
    this.layout(false);
  }
  toggleActiveView(): void {
    if (this.props.activeId) this.change(this.props.activeId, "rules");
  }

  toggleActiveFace(): void {
    if (this.props.activeId) this.change(this.props.activeId, "face");
  }

  destroy(): void {
    this.disposed = true;
    clearTimeout(this.wheelTimer);
    this.unsubscribe?.();
    this.scheduler?.dispose();
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    gsap.killTweensOf(this.scrollMotion);
    for (const entry of this.entries.values()) this.destroyEntry(entry);
    this.entries.clear();
    if (this.initialized) destroyPixiApp(this.app);
  }

  private readonly request = () => {
    this.activeUntil = performance.now() + 250;
    this.scheduler?.request();
  };

  private readonly onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return;
    const rect = this.canvas.getBoundingClientRect();
    const rulesEntry =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? this.rulesEntryAt(event.clientX - rect.left, event.clientY - rect.top)
        : null;
    if (rulesEntry) {
      event.preventDefault();
      event.stopPropagation();
      rulesEntry.sprite.scrollHandRules(event.deltaY, event.deltaMode);
      this.request();
      return;
    }
    if (this.props.items.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const multiplier =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? this.props.width
          : 1;
    this.hoveredId = null;
    this.scrollTarget = this.clampScroll(
      this.scrollTarget + (delta * multiplier) / ZONE_BROWSER_RIBBON_MOTION.wheelPixelsPerCard,
    );
    this.animateScroll(this.scrollTarget, ZONE_BROWSER_RIBBON_MOTION.wheelDuration);
    this.publishNearestActive();
    clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      const index = Math.round(this.scrollTarget);
      this.scrollTo(index);
      this.publishActive(index);
    }, ZONE_BROWSER_RIBBON_MOTION.wheelSnapMs);
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    this.request();
    if (event.pointerType === "mouse" || event.button !== 0 || this.props.items.length < 2) return;
    this.dragPointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartScroll = this.scrollMotion.value;
    this.dragged = false;
    this.canvas.setPointerCapture(event.pointerId);
    gsap.killTweensOf(this.scrollMotion);
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    this.request();
    if (this.dragPointerId !== event.pointerId) return;
    const delta = this.dragStartX - event.clientX;
    if (Math.abs(delta) > ZONE_BROWSER_RIBBON_MOTION.dragThreshold) this.dragged = true;
    if (!this.dragged) return;
    this.suppressTapUntil = performance.now() + 200;
    this.scrolling = true;
    event.preventDefault();
    this.hoveredId = null;
    this.scrollTarget = this.clampScroll(this.dragStartScroll + delta / this.cardReveal());
    this.scrollMotion.value = this.scrollTarget;
    this.layout(true);
    this.publishNearestActive();
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (this.dragPointerId !== event.pointerId) return;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    this.dragPointerId = null;
    if (!this.dragged) return;
    this.suppressTapUntil = performance.now() + 100;
    const index = Math.round(this.scrollTarget);
    this.scrollTo(index);
    this.publishActive(index);
  };

  private cardReveal(): number {
    return Math.max(
      ZONE_BROWSER_RIBBON_MOTION.minReveal,
      Math.min(ZONE_BROWSER_RIBBON_MOTION.reveal, this.props.width / 8),
    );
  }

  private cardDimensions(): { width: number; height: number } {
    const maxHeight = Math.max(160, this.props.height - VIEWPORT_PADDING * 2);
    const width = Math.min(GAME_CARD_SIZES.preview.width, (maxHeight * CARD_W) / CARD_H);
    return { width, height: (width * CARD_H) / CARD_W };
  }

  private clampScroll(value: number): number {
    return Math.max(0, Math.min(Math.max(0, this.props.items.length - 1), value));
  }

  private scrollTo(index: number): void {
    this.scrollTarget = this.clampScroll(index);
    this.animateScroll(this.scrollTarget, ZONE_BROWSER_RIBBON_MOTION.snapDuration);
  }

  private animateScroll(value: number, duration: number): void {
    gsap.killTweensOf(this.scrollMotion);
    if (!animationsEnabled()) {
      this.scrolling = false;
      this.scrollMotion.value = value;
      this.layout(false);
      return;
    }
    this.scrolling = true;
    gsap.to(this.scrollMotion, {
      value,
      duration,
      ease: "power3.out",
      overwrite: true,
      onUpdate: () => {
        this.publishNearestActive();
        this.layout(true);
        this.request();
      },
      onComplete: () => {
        this.scrolling = false;
        this.layout(false);
      },
    });
  }

  private publishNearestActive(): void {
    this.publishActive(Math.round(this.scrollMotion.value));
  }

  private publishActive(index: number): void {
    const item = this.props.items[index];
    if (!item || item.id === this.props.activeId || item.id === this.internalActiveId) return;
    this.internalActiveId = item.id;
    this.props.onActive(item.id);
  }
  private rulesEntryAt(x: number, y: number): CardEntry | null {
    let result: CardEntry | null = null;
    let topZIndex = -Infinity;
    for (const entry of this.entries.values()) {
      if (!entry.sprite.usesHandRulesView || !entry.container.visible) continue;
      const bounds = entry.container.getBounds();
      const contains =
        x >= bounds.x &&
        x <= bounds.x + bounds.width &&
        y >= bounds.y &&
        y <= bounds.y + bounds.height;
      if (!contains || entry.container.zIndex < topZIndex) continue;
      result = entry;
      topZIndex = entry.container.zIndex;
    }
    return result;
  }

  private setHovered(id: string, hovered: boolean): void {
    if (hovered) {
      if (this.hoveredId === id) return;
      this.hoveredId = id;
      this.internalActiveId = id;
      this.props.onActive(id);
    } else if (this.hoveredId === id) {
      this.hoveredId = null;
    } else {
      return;
    }
    this.layout(false);
  }

  private layout(immediate: boolean): void {
    if (!this.initialized || this.disposed) return;
    const items = this.props.items;
    if (!items.length) {
      for (const entry of this.entries.values()) this.destroyEntry(entry);
      this.entries.clear();
      this.request();
      return;
    }
    const reveal = this.cardReveal();
    const { width: cardWidth, height: cardHeight } = this.cardDimensions();
    const radius = Math.ceil(this.props.width / (reveal * 2)) + 3;
    const center = this.scrollMotion.value;
    const start = Math.max(0, Math.floor(center) - radius);
    const end = Math.min(items.length - 1, Math.ceil(center) + radius);
    const visibleIds = new Set<string>();
    const hoveredIndex = this.hoveredId
      ? items.findIndex((candidate) => candidate.id === this.hoveredId)
      : -1;
    const activeIndex = this.props.activeId
      ? items.findIndex((candidate) => candidate.id === this.props.activeId)
      : -1;
    const focusPosition =
      hoveredIndex >= 0
        ? hoveredIndex
        : this.scrolling
          ? center
          : activeIndex >= 0
            ? activeIndex
            : center;
    const lowerFocus = Math.floor(focusPosition);
    const upperFocus = Math.ceil(focusPosition);
    const focusMix = focusPosition - lowerFocus;
    const easedFocusMix = focusMix * focusMix * (3 - 2 * focusMix);
    const feedbackColor = hexToNum(this.props.ringColor);
    for (let index = start; index <= end; index += 1) {
      const item = items[index];
      visibleIds.add(item.id);
      const entry = this.entryFor(item);
      const state = this.inspectionFor(item);
      this.configure(entry, item, state);
      const rotated = entry.sprite.horizontalFrame && state.rotated;
      const horizontal = entry.sprite.horizontalFrame && !rotated;
      const baseWidth = horizontal ? CARD_H : CARD_W;
      const baseHeight = horizontal ? CARD_W : CARD_H;
      const scale = Math.min(cardWidth / baseWidth, cardHeight / baseHeight);
      entry.sprite.rotation = rotated ? -Math.PI / 2 : 0;
      entry.sprite.scale.set(scale);
      entry.sprite.syncHandControlsScale();
      const displayWidth = baseWidth * scale;
      const displayHeight = baseHeight * scale;
      const lowerSpread =
        index === lowerFocus
          ? 0
          : index < lowerFocus
            ? -ZONE_BROWSER_RIBBON_MOTION.focusSpread
            : ZONE_BROWSER_RIBBON_MOTION.focusSpread;
      const upperSpread =
        index === upperFocus
          ? 0
          : index < upperFocus
            ? -ZONE_BROWSER_RIBBON_MOTION.focusSpread
            : ZONE_BROWSER_RIBBON_MOTION.focusSpread;
      const spread = lowerSpread + (upperSpread - lowerSpread) * easedFocusMix;
      const rawFocus = Math.max(0, 1 - Math.abs(index - focusPosition));
      const focusAmount = rawFocus * rawFocus * (3 - 2 * rawFocus);
      const active = item.id === this.props.activeId;
      const selected = !!item.selected;
      const x = this.props.width / 2 + (index - center) * reveal + spread;
      const y = this.props.height / 2 - ZONE_BROWSER_RIBBON_MOTION.focusLift * focusAmount;
      const containerScale = 1 + ZONE_BROWSER_RIBBON_MOTION.focusScale * focusAmount;
      const elevation = Math.max(focusAmount, selected ? 0.45 : 0);
      const ringAlpha = selected ? 1 : Math.max(active ? 0.78 : 0, focusAmount);
      entry.sprite.alpha = 1;
      entry.sprite.cursor = this.props.pending ? "default" : "pointer";
      const feedbackStroke = selected ? 4 : 3;
      const feedbackRadius =
        (entry.sprite.usesHandRulesView
          ? rulesCardRadius(displayWidth, displayHeight)
          : CARD_RADIUS * scale) + 3;
      if (
        entry.feedbackWidth !== displayWidth ||
        entry.feedbackHeight !== displayHeight ||
        entry.feedbackColor !== feedbackColor ||
        entry.feedbackStroke !== feedbackStroke ||
        entry.feedbackRadius !== feedbackRadius
      ) {
        entry.feedbackWidth = displayWidth;
        entry.feedbackHeight = displayHeight;
        entry.feedbackColor = feedbackColor;
        entry.feedbackStroke = feedbackStroke;
        entry.feedbackRadius = feedbackRadius;
        entry.feedback
          .clear()
          .roundRect(
            -displayWidth / 2 - 3,
            -displayHeight / 2 - 3,
            displayWidth + 6,
            displayHeight + 6,
            feedbackRadius,
          )
          .stroke({ color: feedbackColor, width: feedbackStroke });
      }
      entry.container.zIndex = 1_000 - Math.abs(index - focusPosition) * 10 + focusAmount * 5;
      this.place(entry, x, y, containerScale, elevation, ringAlpha, immediate);
    }
    for (const [id, entry] of this.entries) {
      if (visibleIds.has(id)) continue;
      this.destroyEntry(entry);
      this.entries.delete(id);
    }
    this.request();
  }

  private entryFor(item: CardBrowserItem): CardEntry {
    let entry = this.entries.get(item.id);
    if (entry) {
      if (entry.item.card !== item.card) {
        entry.sprite.updateCardContent(item.card);
        entry.viewKey = "";
      }
      entry.item = item;
      return entry;
    }
    const container = new Container();
    const feedback = new Graphics();
    const sprite = new CardSprite(item.card, "hand");
    feedback.eventMode = "none";
    feedback.alpha = 0;
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointertap", (event) => {
      event.stopPropagation();
      if (this.props.pending || performance.now() < this.suppressTapUntil) return;
      this.internalActiveId = item.id;
      this.props.onActive(item.id);
    });
    sprite.on("pointerdown", (event) => event.stopPropagation());
    sprite.on("pointerenter", () => this.setHovered(item.id, true));
    sprite.on("pointerleave", () => this.setHovered(item.id, false));
    sprite.onReorient = () => {
      const current = this.entries.get(item.id);
      if (current) {
        current.viewKey = "";
        current.feedbackWidth = -1;
      }
      this.update(this.props);
    };
    container.addChild(feedback, sprite);
    this.app.stage.addChild(container);
    entry = {
      item,
      container,
      sprite,
      feedback,
      viewKey: "",
      feedbackWidth: -1,
      feedbackHeight: -1,
      feedbackColor: -1,
      feedbackStroke: -1,
      feedbackRadius: -1,
      fresh: true,
      motion: { x: 0, y: 0, scale: 1, elevation: 0, ringAlpha: 0 },
    };
    this.entries.set(item.id, entry);
    return entry;
  }

  private inspectionFor(item: CardBrowserItem): CardInspectionState {
    return (
      this.props.inspection[item.id] ?? {
        rules: this.props.defaultRules,
        face: item.card.isTransformed ? 1 : 0,
        rotated: false,
      }
    );
  }

  private configure(entry: CardEntry, item: CardBrowserItem, state: CardInspectionState): void {
    const viewKey = `${state.rules}:${state.face}:${state.rotated}`;
    if (entry.viewKey === viewKey) return;
    entry.viewKey = viewKey;
    entry.sprite.setPreviewFace(state.face);
    entry.sprite.setHandRulesView(state.rules && !isFacelessCard(item.card));
    entry.sprite.setHandRulesHighlight("");
    entry.sprite.setHandControls(
      isFacelessCard(item.card)
        ? null
        : {
            rulesView: state.rules,
            horizontal: entry.sprite.horizontalFrame && !item.card.isDoubleFaced,
            alternateFace: item.card.isDoubleFaced ? state.face === 1 : !state.rotated,
            showFaceControl: item.card.isDoubleFaced || entry.sprite.horizontalFrame,
            onToggleRules: () => this.change(item.id, "rules"),
            onToggleFace: () => this.change(item.id, "face"),
          },
    );
  }

  private change(id: string, kind: "rules" | "face"): void {
    const item = this.props.items.find((candidate) => candidate.id === id);
    const entry = this.entries.get(id);
    if (!item || !entry || isFacelessCard(item.card)) return;
    const state = this.inspectionFor(item);
    this.props.onChange(
      item,
      kind === "rules"
        ? { ...state, rules: !state.rules }
        : item.card.isDoubleFaced
          ? { ...state, face: state.face === 0 ? 1 : 0, rotated: false }
          : entry.sprite.horizontalFrame
            ? { ...state, rotated: !state.rotated }
            : state,
    );
    this.request();
  }

  private place(
    entry: CardEntry,
    x: number,
    y: number,
    scale: number,
    elevation: number,
    ringAlpha: number,
    immediate: boolean,
  ): void {
    const unchanged =
      !entry.fresh &&
      entry.motion.x === x &&
      entry.motion.y === y &&
      entry.motion.scale === scale &&
      entry.motion.elevation === elevation &&
      entry.motion.ringAlpha === ringAlpha;
    if (unchanged) return;
    entry.motion.x = x;
    entry.motion.y = y;
    entry.motion.scale = scale;
    entry.motion.elevation = elevation;
    entry.motion.ringAlpha = ringAlpha;
    gsap.killTweensOf(entry.container.position);
    gsap.killTweensOf(entry.container.scale);
    gsap.killTweensOf(entry.feedback);
    gsap.killTweensOf(entry.motion);
    if (immediate || !animationsEnabled()) {
      entry.container.position.set(x, y);
      entry.container.scale.set(scale);
      entry.container.alpha = 1;
      entry.feedback.alpha = ringAlpha;
      entry.sprite.setElevation(elevation);
      entry.fresh = false;
      return;
    }
    if (entry.fresh) {
      entry.container.position.set(x, y + 36);
      entry.container.scale.set(scale * 0.9);
      entry.container.alpha = 0;
      entry.fresh = false;
    }
    const duration = ZONE_BROWSER_RIBBON_MOTION.layoutDuration;
    const tween = {
      duration,
      ease: "power3.out",
      overwrite: true,
      onUpdate: this.request,
    };
    gsap.to(entry.container.position, { x, y, ...tween });
    gsap.to(entry.container.scale, { x: scale, y: scale, ...tween });
    gsap.to(entry.container, {
      alpha: 1,
      duration: ZONE_BROWSER_RIBBON_MOTION.entryDuration,
      ease: "power2.out",
      onUpdate: this.request,
    });
    gsap.to(entry.feedback, {
      alpha: ringAlpha,
      duration: ZONE_BROWSER_RIBBON_MOTION.feedbackDuration,
      ease: "power2.out",
      onUpdate: this.request,
    });
    gsap.to(entry.motion, {
      elevation,
      duration: ZONE_BROWSER_RIBBON_MOTION.elevationDuration,
      ease: "power2.out",
      onUpdate: () => {
        entry.sprite.setElevation(entry.motion.elevation);
        this.request();
      },
    });
  }

  private destroyEntry(entry: CardEntry): void {
    gsap.killTweensOf(entry.container.position);
    gsap.killTweensOf(entry.container.scale);
    gsap.killTweensOf(entry.container);
    gsap.killTweensOf(entry.feedback);
    gsap.killTweensOf(entry.motion);
    this.app.stage.removeChild(entry.container);
    entry.sprite.destroy({ children: true });
    entry.feedback.destroy();
    entry.container.destroy();
  }
}

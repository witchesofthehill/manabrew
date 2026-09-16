import { Application, Graphics } from "pixi.js";
import type { CardDto } from "@/protocol/game";
import {
  CARD_H,
  CARD_HOVER_TRANSITION_SECONDS,
  CARD_RADIUS,
  CARD_W,
  PASSIVE_CARD_HOVER_SCALE,
  PROMPT_CARD_GAP,
} from "@/components/game/game.constants";
import { centeredCardRowOffset } from "@/components/game/game.utils";
import { CardSprite } from "@/pixi/CardSprite";
import { bindPreviewScroll } from "@/pixi/cardPreview/previewScroll";
import { hexToNum } from "@/pixi/colorUtils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { OverlayRenderScheduler, overlayResolution } from "@/pixi/overlay/overlayRuntime";
import { gsap } from "@/pixi/effects/gsap";
import { destroyPixiApp } from "@/pixi/pixiPatches";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { isFacelessCard } from "@/lib/gameCard";
import { getTheme } from "@/hooks/useTheme";
import type { CardInspectionState } from "./cardInspection";
import {
  CARD_BROWSER_HORIZONTAL_PADDING,
  CARD_BROWSER_VERTICAL_PADDING,
  type CardBrowserItem,
  type CardBrowserState,
} from "./cardBrowser";

export interface DialogCardPickerSceneProps {
  items: CardBrowserItem[];
  itemCount: number;
  startIndex: number;
  state: CardBrowserState;
  defaultRules: boolean;
  columns: number;
  cellWidth: number;
  cellHeight: number;
  rowHeight: number;
  scrollTop: number;
  cardSize: number;
  width: number;
  height: number;
  actionable: boolean;
  pending: boolean;
  ringColor: string;
  onSelect: (id: string) => void;
  onActivate?: (item: CardBrowserItem) => void;
  onHover: (id: string | null) => void;
  onChange: (item: CardBrowserItem, state: CardInspectionState) => void;
}

interface CardEntry {
  card: CardDto;
  sprite: CardSprite;
  feedback: Graphics;
  baseScale: number;
  targetScale: number;
  targetAlpha: number;
  viewKey: string;
}

export class DialogCardPickerScene {
  private readonly app = new Application();
  private readonly entries = new Map<string, CardEntry>();
  private props: DialogCardPickerSceneProps;
  private readonly canvas: HTMLCanvasElement;
  private readonly onError: (error: string) => void;
  private initialized = false;
  private motionEnabled = animationsEnabled();
  private disposed = false;
  private scheduler: OverlayRenderScheduler | null = null;
  private unsubscribe: (() => void) | null = null;
  private unbindPreviewScroll: (() => void) | null = null;
  private activeUntil = 0;

  private hoveredId: string | null = null;
  constructor(
    canvas: HTMLCanvasElement,
    props: DialogCardPickerSceneProps,
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
      this.scheduler = new OverlayRenderScheduler(this.app, () =>
        [...this.entries.values()].some(
          ({ sprite, card }) =>
            !sprite.imageSettled ||
            performance.now() < this.activeUntil ||
            (animationsEnabled() && card.foil),
        ),
      );
      this.unsubscribe = useScryfallStore.subscribe(this.request);
      this.unbindPreviewScroll = bindPreviewScroll(
        this.canvas,
        (clientX, clientY) => this.rulesSpriteAt(clientX, clientY) !== null,
        (delta, mode, clientX, clientY) => {
          this.rulesSpriteAt(clientX, clientY)?.scrollHandRules(delta, mode);
          this.request();
        },
      );
      this.canvas.addEventListener("pointermove", this.request);
      this.canvas.addEventListener("pointerdown", this.request);
      this.canvas.addEventListener("wheel", this.request);
      this.update(this.props);
    } catch (cause) {
      if (!this.disposed) this.onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  update(props: DialogCardPickerSceneProps): void {
    this.props = props;
    if (this.hoveredId && props.pending) {
      this.hoveredId = null;
      this.props.onHover(null);
    }
    if (!this.initialized || this.disposed) return;
    const width = Math.max(1, props.width);
    const height = Math.max(1, props.height);
    if (this.app.screen.width !== width || this.app.screen.height !== height) {
      this.app.renderer.resize(width, height);
    }
    const visibleIds = new Set(props.items.map((item) => item.id));
    for (const [id, entry] of this.entries) {
      if (visibleIds.has(id)) continue;
      if (this.hoveredId === id) {
        this.hoveredId = null;
        this.props.onHover(null);
      }
      gsap.killTweensOf(entry.sprite.scale);
      gsap.killTweensOf(entry.feedback);
      this.app.stage.removeChild(entry.sprite, entry.feedback);
      entry.sprite.destroy({ children: true });
      entry.feedback.destroy();
      this.entries.delete(id);
    }
    props.items.forEach((item, offset) => {
      const entry = this.entryFor(item);
      const state = this.inspectionFor(item);
      this.configure(entry, item, state);
      const absoluteIndex = props.startIndex + offset;
      const rotated = entry.sprite.horizontalFrame && state.rotated;
      const horizontal = entry.sprite.horizontalFrame && !rotated;
      const cardWidth = horizontal ? CARD_H : CARD_W;
      const cardHeight = horizontal ? CARD_W : CARD_H;
      const scale = props.cardSize / CARD_W;
      const active = props.state.activeId === item.id;
      const selected = !!item.selected;
      const clickable = this.canActivateItem(item);
      const passiveFocused =
        !props.pending && (this.hoveredId === item.id || active) && !clickable && !selected;
      const displayScale = scale * (passiveFocused ? PASSIVE_CARD_HOVER_SCALE : 1);
      entry.baseScale = scale;
      entry.targetScale = displayScale;
      gsap.killTweensOf(entry.sprite.scale);
      entry.sprite.rotation = rotated ? -Math.PI / 2 : 0;
      entry.sprite.scale.set(displayScale);
      entry.sprite.setChromeScale(1 / scale);
      entry.sprite.syncHandControlsScale();
      const row = Math.floor(absoluteIndex / props.columns);
      const cardsInRow = Math.min(props.columns, props.itemCount - row * props.columns);
      const gridWidth = props.width - CARD_BROWSER_HORIZONTAL_PADDING * 2;
      const rowX =
        CARD_BROWSER_HORIZONTAL_PADDING +
        centeredCardRowOffset(gridWidth, cardsInRow, props.cellWidth, PROMPT_CARD_GAP);
      const x =
        rowX +
        (absoluteIndex % props.columns) * (props.cellWidth + PROMPT_CARD_GAP) +
        props.cellWidth / 2;
      const y =
        CARD_BROWSER_VERTICAL_PADDING +
        Math.floor(absoluteIndex / props.columns) * props.rowHeight -
        props.scrollTop +
        props.cellHeight / 2;
      entry.sprite.position.set(x, y);
      const displayWidth = cardWidth * scale;
      const displayHeight = cardHeight * scale;
      const feedbackColor = hexToNum(
        selected ? getTheme().gameTheme.cardSelection : props.ringColor,
      );
      entry.feedback
        .clear()
        .roundRect(
          -displayWidth / 2 - 7,
          -displayHeight / 2 - 7,
          displayWidth + 14,
          displayHeight + 14,
          Math.max(6, CARD_RADIUS * scale + 7),
        )
        .stroke({ color: feedbackColor, width: 8, alpha: 0.2 })
        .roundRect(
          -displayWidth / 2 - 2,
          -displayHeight / 2 - 2,
          displayWidth + 4,
          displayHeight + 4,
          Math.max(6, CARD_RADIUS * scale + 2),
        )
        .stroke({
          color: feedbackColor,
          width: active || selected ? 3 : 2,
        });
      entry.feedback.position.set(x, y);
      entry.sprite.cursor = clickable ? "pointer" : "default";
      entry.sprite.alpha = 1;
    });
    this.updateFeedback();
    this.request();
  }

  destroy(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unbindPreviewScroll?.();
    this.unbindPreviewScroll = null;
    this.scheduler?.dispose();
    this.canvas.removeEventListener("pointermove", this.request);
    this.canvas.removeEventListener("pointerdown", this.request);
    this.canvas.removeEventListener("wheel", this.request);
    for (const { sprite, feedback } of this.entries.values()) {
      gsap.killTweensOf(sprite.scale);
      gsap.killTweensOf(feedback);
      this.app.stage.removeChild(sprite, feedback);
      sprite.destroy({ children: true });
      feedback.destroy();
    }
    this.entries.clear();
    if (this.initialized) destroyPixiApp(this.app);
  }

  private readonly request = () => {
    this.activeUntil = performance.now() + 250;
    this.scheduler?.request();
  };
  private rulesSpriteAt(clientX: number, clientY: number): CardSprite | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((clientX - rect.left) * this.app.screen.width) / rect.width;
    const y = ((clientY - rect.top) * this.app.screen.height) / rect.height;
    let result: CardSprite | null = null;
    let topZIndex = -Infinity;
    for (const { sprite } of this.entries.values()) {
      if (!sprite.usesHandRulesView || !sprite.visible || sprite.alpha === 0) continue;
      const bounds = sprite.getBounds();
      const contains =
        x >= bounds.x &&
        x <= bounds.x + bounds.width &&
        y >= bounds.y &&
        y <= bounds.y + bounds.height;
      if (!contains || sprite.zIndex < topZIndex) continue;
      result = sprite;
      topZIndex = sprite.zIndex;
    }
    return result;
  }

  private entryFor(item: CardBrowserItem): CardEntry {
    let entry = this.entries.get(item.id);
    if (!entry) {
      const sprite = new CardSprite(item.card, "hand");
      const feedback = new Graphics();
      feedback.alpha = 0;
      feedback.eventMode = "none";
      sprite.eventMode = "static";
      sprite.on("pointertap", (event) => {
        event.stopPropagation();
        this.activate(item.id);
      });
      sprite.on("pointerdown", (event) => event.stopPropagation());
      sprite.on("pointerenter", () => this.setHovered(item.id, true));
      sprite.on("pointerleave", () => this.setHovered(item.id, false));
      sprite.on("pointerdowncapture", () => this.setHovered(item.id, true));
      sprite.onReorient = () => this.update(this.props);
      this.app.stage.addChild(sprite, feedback);
      entry = {
        card: item.card,
        sprite,
        feedback,
        baseScale: 1,
        targetScale: 1,
        targetAlpha: 0,
        viewKey: "",
      };
      this.entries.set(item.id, entry);
    } else if (entry.card !== item.card) {
      entry.card = item.card;
      entry.sprite.updateCardContent(item.card);
      entry.viewKey = "";
    }
    return entry;
  }

  private inspectionFor(item: CardBrowserItem): CardInspectionState {
    return (
      this.props.state.inspection[item.id] ?? {
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

  private canActivateItem(item: CardBrowserItem | undefined): boolean {
    return (
      !!item && this.props.actionable && !this.props.pending && (!!item.legal || !!item.selected)
    );
  }

  private canActivate(id: string): boolean {
    return this.canActivateItem(this.props.items.find((candidate) => candidate.id === id));
  }

  private activate(id: string): void {
    const item = this.props.items.find((candidate) => candidate.id === id);
    if (!this.props.actionable) return;
    if (!item || !this.canActivate(id)) return;
    this.props.onSelect(id);
    this.props.onActivate?.(item);
  }

  private setHovered(id: string, hovered: boolean): void {
    if (hovered && this.props.pending) return;
    if (hovered) {
      if (this.hoveredId === id) return;
      this.hoveredId = id;
    } else if (this.hoveredId === id) {
      this.hoveredId = null;
    } else {
      return;
    }
    this.props.onHover(this.hoveredId);
    this.updateFeedback();
    this.request();
  }

  private updateFeedback(): void {
    const selectedIds = new Set(
      this.props.items.filter((item) => item.selected).map((item) => item.id),
    );
    const clickableIds = new Set(
      this.props.items.filter((item) => this.canActivateItem(item)).map((item) => item.id),
    );
    const motionEnabled = animationsEnabled();
    const motionChanged = motionEnabled !== this.motionEnabled;
    this.motionEnabled = motionEnabled;
    const ringColor = hexToNum(this.props.ringColor);
    for (const [id, entry] of this.entries) {
      const clickable = clickableIds.has(id);
      const hovered = !this.props.pending && this.hoveredId === id;
      const active = !this.props.pending && this.props.state.activeId === id;
      const selected = selectedIds.has(id);
      const focused = hovered || active;
      const emphasized = selected || (clickable && focused);
      const zoomed = focused && !clickable && !selected;
      entry.sprite.setPlayableRing(clickable && !emphasized ? ringColor : null);
      const targetScale = entry.baseScale * (zoomed ? PASSIVE_CARD_HOVER_SCALE : 1);
      if (motionChanged || entry.targetScale !== targetScale) {
        entry.targetScale = targetScale;
        gsap.killTweensOf(entry.sprite.scale);
        if (!motionEnabled) {
          entry.sprite.scale.set(targetScale);
        } else {
          gsap.to(entry.sprite.scale, {
            x: targetScale,
            y: targetScale,
            duration: CARD_HOVER_TRANSITION_SECONDS,
            ease: "power2.out",
          });
        }
      }

      const alpha = emphasized ? 1 : 0;
      if (!motionChanged && entry.targetAlpha === alpha) continue;
      entry.targetAlpha = alpha;
      gsap.killTweensOf(entry.feedback);
      if (!motionEnabled) {
        entry.feedback.alpha = alpha;
        continue;
      }
      gsap.to(entry.feedback, {
        alpha,
        duration: CARD_HOVER_TRANSITION_SECONDS,
        ease: "power2.out",
      });
    }
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
}

import { Application, Graphics } from "pixi.js";
import type { CardDto } from "@/protocol/game";
import { CARD_H, CARD_RADIUS, CARD_W } from "@/components/game/game.constants";
import { CardSprite } from "@/pixi/CardSprite";
import { hexToNum } from "@/pixi/colorUtils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { OverlayRenderScheduler, overlayResolution } from "@/pixi/overlay/overlayRuntime";
import { gsap } from "@/pixi/effects/gsap";
import { destroyPixiApp } from "@/pixi/pixiPatches";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { isFacelessCard } from "@/lib/gameCard";
import type { CardInspectionState } from "./cardInspection";
import {
  CARD_BROWSER_GAP,
  CARD_BROWSER_VERTICAL_PADDING,
  type CardBrowserItem,
  type CardBrowserState,
} from "./cardBrowser";

export interface DialogCardPickerSceneProps {
  items: CardBrowserItem[];
  startIndex: number;
  state: CardBrowserState;
  defaultRules: boolean;
  columns: number;
  cellWidth: number;
  rowHeight: number;
  scrollTop: number;
  cardSize: number;
  width: number;
  height: number;
  actionable: boolean;
  ringColor: string;
  onSelect: (id: string) => void;
  onHover: (id: string) => void;
  onChange: (item: CardBrowserItem, state: CardInspectionState) => void;
}

interface CardEntry {
  card: CardDto;
  sprite: CardSprite;
  feedback: Graphics;
  motion: {
    elevation: number;
    targetAlpha: number;
    targetElevation: number;
  };
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
    if (!this.initialized || this.disposed) return;
    const width = Math.max(1, props.width);
    const height = Math.max(1, props.height);
    if (this.app.screen.width !== width || this.app.screen.height !== height) {
      this.app.renderer.resize(width, height);
    }
    const visibleIds = new Set(props.items.map((item) => item.id));
    for (const [id, entry] of this.entries) {
      if (visibleIds.has(id)) continue;
      if (this.hoveredId === id) this.hoveredId = null;
      gsap.killTweensOf(entry.feedback);
      gsap.killTweensOf(entry.motion);
      this.app.stage.removeChild(entry.sprite, entry.feedback);
      entry.sprite.destroy({ children: true });
      entry.feedback.destroy();
      this.entries.delete(id);
    }
    const portraitHeight = (props.cardSize * CARD_H) / CARD_W;
    props.items.forEach((item, offset) => {
      const entry = this.entryFor(item);
      const state = this.inspectionFor(item);
      this.configure(entry, item, state);
      const absoluteIndex = props.startIndex + offset;
      const rotated = entry.sprite.horizontalFrame && state.rotated;
      const horizontal = entry.sprite.horizontalFrame && !rotated;
      const cardWidth = horizontal ? CARD_H : CARD_W;
      const cardHeight = horizontal ? CARD_W : CARD_H;
      const scale = Math.min(props.cardSize / cardWidth, portraitHeight / cardHeight);
      entry.sprite.rotation = rotated ? -Math.PI / 2 : 0;
      entry.sprite.scale.set(scale);
      const x =
        (absoluteIndex % props.columns) * (props.cellWidth + CARD_BROWSER_GAP) +
        props.cellWidth / 2;
      const y =
        CARD_BROWSER_VERTICAL_PADDING +
        Math.floor(absoluteIndex / props.columns) * props.rowHeight -
        props.scrollTop +
        portraitHeight / 2;
      entry.sprite.position.set(x, y);
      const displayWidth = cardWidth * scale;
      const displayHeight = cardHeight * scale;
      entry.feedback
        .clear()
        .roundRect(
          -displayWidth / 2 - 2,
          -displayHeight / 2 - 2,
          displayWidth + 4,
          displayHeight + 4,
          Math.max(6, CARD_RADIUS * scale + 2),
        )
        .stroke({ color: hexToNum(props.ringColor), width: 2 });
      entry.feedback.position.set(x, y);
      entry.sprite.alpha = props.actionable && !item.legal && !item.selected ? 0.7 : 1;
    });
    this.updateFeedback();
    this.request();
  }

  destroy(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.scheduler?.dispose();
    this.canvas.removeEventListener("pointermove", this.request);
    this.canvas.removeEventListener("pointerdown", this.request);
    this.canvas.removeEventListener("wheel", this.request);
    for (const { sprite, feedback, motion } of this.entries.values()) {
      gsap.killTweensOf(feedback);
      gsap.killTweensOf(motion);
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

  private entryFor(item: CardBrowserItem): CardEntry {
    let entry = this.entries.get(item.id);
    if (!entry) {
      const sprite = new CardSprite(item.card, "hand");
      const feedback = new Graphics();
      feedback.alpha = 0;
      feedback.eventMode = "none";
      sprite.eventMode = "static";
      sprite.cursor = "pointer";
      sprite.on("pointertap", (event) => {
        event.stopPropagation();
        this.props.onSelect(item.id);
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
        motion: { elevation: 0, targetAlpha: 0, targetElevation: 0 },
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

  private setHovered(id: string, hovered: boolean): void {
    if (hovered) {
      if (this.hoveredId === id) return;
      this.hoveredId = id;
      this.props.onHover(id);
    } else if (this.hoveredId === id) {
      this.hoveredId = null;
    } else {
      return;
    }
    this.updateFeedback();
    this.request();
  }

  private updateFeedback(): void {
    const selectedIds = new Set(
      this.props.items.filter((item) => item.selected).map((item) => item.id),
    );
    const motionEnabled = animationsEnabled();
    const motionChanged = motionEnabled !== this.motionEnabled;
    this.motionEnabled = motionEnabled;
    for (const [id, entry] of this.entries) {
      const hovered = this.hoveredId === id;
      const active = this.props.state.activeId === id;
      const selected = selectedIds.has(id);
      const alpha = selected || hovered ? 1 : active ? 0.72 : 0;
      const elevation = hovered ? 1 : active || selected ? 0.35 : 0;
      if (
        !motionChanged &&
        entry.motion.targetAlpha === alpha &&
        entry.motion.targetElevation === elevation
      )
        continue;
      entry.motion.targetAlpha = alpha;
      entry.motion.targetElevation = elevation;
      gsap.killTweensOf(entry.feedback);
      gsap.killTweensOf(entry.motion);
      if (!motionEnabled) {
        entry.feedback.alpha = alpha;
        entry.motion.elevation = elevation;
        entry.sprite.setElevation(elevation);
        continue;
      }
      gsap.to(entry.feedback, {
        alpha,
        duration: 0.12,
        ease: "power2.out",
      });
      gsap.to(entry.motion, {
        elevation,
        duration: 0.12,
        ease: "power2.out",
        onUpdate: () => entry.sprite.setElevation(entry.motion.elevation),
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

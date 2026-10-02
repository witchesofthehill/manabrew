import { Container, Graphics, Sprite, Text } from "pixi.js";
import { getTheme, subscribeTheme } from "@/hooks/useTheme";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { hexToNum } from "@/pixi/colorUtils";
import {
  DRAG_LIFT_SCALE,
  dragPositionBlend,
  dragTransformBlend,
  dragTiltForMovement,
} from "@/pixi/dragMotion";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import { LongPressGesture } from "@/pixi/LongPressGesture";
import { MarqueeHandler, type MarqueeCardPosition } from "@/pixi/MarqueeHandler";
import {
  acquireLimitedRenderer,
  type LimitedPane,
  type LimitedRenderer,
} from "@/pixi/limited/LimitedRenderer";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { LimitedBoosterReveal } from "@/pixi/limited/LimitedBoosterReveal";
import {
  LIMITED_DRAG_THRESHOLD,
  type LimitedCell,
  type LimitedLayout,
} from "@/pixi/limited/limitedLayout";
import type { DraftCard } from "@/types/limited";

export interface LimitedSceneProps {
  layout: LimitedLayout;
  width: number;
  height: number;
  scrollTop: number;
  selectedIds: readonly string[];
  disabled: boolean;
  arrivalKey?: string;
  arrivalDirection?: "left" | "right";
  acquiredIds?: readonly string[];
  departureTarget?: () => HTMLElement | null;
  opening: boolean;
  onSelect?: (card: DraftCard, additive: boolean) => void;
  onSelectMany?: (ids: string[]) => void;
  onActivate?: (card: DraftCard) => void;
  onDrop?: (card: DraftCard, clientX: number, clientY: number) => void;
  onInspect: (card: DraftCard | null, sticky: boolean) => void;
}
interface CardEntry {
  cell: LimitedCell;
  root: Container;
  motion: Container;
  pose: Container;
  image: Sprite;
  frame: Graphics;
  label: Text;
  locale: string;
  loading: boolean;
  layoutTimeline: gsap.core.Timeline | null;
  motionTimeline: gsap.core.Timeline | null;
  poseTimeline: gsap.core.Timeline | null;
  poseLift: number;
  poseRotation: number;
  poseScale: number;
}
interface Drag {
  pointerId: number;
  entry: CardEntry;
  startX: number;
  startY: number;
  active: boolean;
  pointerType: string;
  additive: boolean;
  target: EventTarget | null;
  table: Element | null;
  inspected: boolean;
  targetX: number;
  targetY: number;
  lastX: number;
  lastY: number;
  targetRotation: number;
  restRotation: number;
  restScaleX: number;
  restScaleY: number;
  dropZone: Element | null;
  settleTimeline: gsap.core.Timeline | null;
}
const DEAL_DURATION = 0.38;
const DEAL_STAGGER = 0.025;
const DEAL_STAGGER_LIMIT = 0.18;
const REFLOW_DURATION = 0.24;
const POSE_DURATION = 0.16;
const POOL_SETTLE_DELAY = 0.28;
const POOL_SETTLE_DURATION = 0.26;
const HOVER_LIFT = 9;
const SELECTED_LIFT = 4;
const HOVER_TILT = -0.025;
const HOVER_SCALE = 1.035;
const SELECTED_SCALE = 1.015;

export class LimitedCardScene implements LimitedPane {
  readonly root = new Container();
  private readonly entries = new Map<string, CardEntry>();
  private readonly headings = new Container();
  private readonly longPress = new LongPressGesture();
  private readonly renderer: LimitedRenderer;
  private readonly reveal: LimitedBoosterReveal;
  private unsubscribeTheme: (() => void) | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private initialized = false;
  private disposed = false;
  private arrivalKey: string | undefined;
  private knownIds = new Set<string>();
  private acquiredIds = new Set<string>();
  private readonly acceptedIds = new Set<string>();
  private hasLayout = false;
  private hoveredId: string | null = null;
  private revealing = false;
  private drag: Drag | null = null;
  private readonly marquee = new MarqueeHandler();
  private marqueePointerId: number | null = null;
  private settling: Drag | null = null;
  private lastTap: { id: string; time: number } | null = null;
  readonly host: HTMLElement;
  private props: LimitedSceneProps;
  private readonly onError: (error: string) => void;
  constructor(host: HTMLElement, props: LimitedSceneProps, onError: (error: string) => void) {
    this.host = host;
    this.props = props;
    this.onError = onError;
    this.root.eventMode = "none";
    this.root.sortableChildren = true;
    this.root.addChild(this.headings);
    this.reveal = new LimitedBoosterReveal(this.root, this.request);
    this.renderer = acquireLimitedRenderer(this);
  }
  async init(): Promise<void> {
    try {
      await this.renderer.ready;
      if (this.disposed) return;
      this.initialized = true;
      this.unsubscribeTheme = subscribeTheme(() => this.update(this.props));
      this.unsubscribeStore = useScryfallStore.subscribe((state, previous) => {
        if (state.locale !== previous.locale) this.update(this.props);
      });
      window.addEventListener("pointermove", this.move);
      window.addEventListener("pointerup", this.release);
      window.addEventListener("pointercancel", this.cancelPointer);
      window.addEventListener("blur", this.abort);
      window.addEventListener("scroll", this.abort, true);
      window.addEventListener("resize", this.abort);
      window.visualViewport?.addEventListener("scroll", this.abort);
      document.addEventListener("visibilitychange", this.visibilityChanged);
      this.update(this.props);
    } catch (error) {
      if (!this.disposed) this.onError(error instanceof Error ? error.message : String(error));
    }
  }
  readonly frame = (deltaMs: number): boolean => {
    const drag = this.drag ?? this.settling;
    if (
      drag &&
      (!this.host.isConnected ||
        !drag.table?.isConnected ||
        drag.table !== this.host.closest("[data-limited-table]"))
    )
      this.abort();
    if (!animationsEnabled()) this.finishAnimations();
    this.updateDragMotion(deltaMs);
    if (this.revealing && !this.reveal.active) {
      for (const entry of this.entries.values()) this.updatePose(entry);
    }
    this.revealing = this.reveal.active;
    if (this.reveal.active) return true;
    for (const entry of this.entries.values()) {
      if (entry.layoutTimeline || entry.motionTimeline || entry.poseTimeline) return true;
    }
    if (this.settling || (this.drag?.active && animationsEnabled())) return true;
    return false;
  };
  update(props: LimitedSceneProps): void {
    const scrollChanged = this.props.scrollTop !== props.scrollTop;
    this.props = props;
    if (!this.initialized || this.disposed) return;
    const allIds = new Set(props.layout.cells.map(({ card }) => card.id));
    const acquiredIds = new Set(props.acquiredIds);
    for (const id of acquiredIds) {
      if (!this.acquiredIds.has(id) && this.knownIds.has(id)) this.acceptedIds.add(id);
    }
    const addedIds = this.hasLayout
      ? new Set(
          props.acquiredIds
            ? props.acquiredIds.filter((id) => !this.acquiredIds.has(id))
            : props.layout.cells
                .filter(({ card }) => !this.knownIds.has(card.id))
                .map(({ card }) => card.id),
        )
      : new Set<string>();
    const visible = props.layout.cells.filter(
      (cell) =>
        cell.y + cell.height >= props.scrollTop - cell.height &&
        cell.y <= props.scrollTop + props.height + cell.height,
    );
    const visibleIds = new Set(visible.map(({ card }) => card.id));
    const newArrival = props.arrivalKey !== this.arrivalKey;
    const freshDeal =
      newArrival &&
      (!this.hasLayout || !props.layout.cells.some(({ card }) => this.knownIds.has(card.id)));
    const layoutChanged = visible.some((cell) => {
      const previous = this.entries.get(cell.card.id)?.cell;
      return previous && this.cellChanged(previous, cell);
    });
    if (newArrival || scrollChanged || !props.opening || layoutChanged) this.reveal.finish();
    if (
      props.disabled ||
      scrollChanged ||
      newArrival ||
      (!props.onDrop && this.drag?.active) ||
      (!props.onSelectMany && this.marquee.isActive)
    )
      this.abort();
    if (!animationsEnabled()) this.finishAnimations();
    for (const [id, entry] of this.entries) {
      if (visibleIds.has(id)) continue;
      if (
        !allIds.has(id) &&
        acquiredIds.has(id) &&
        this.acceptedIds.has(id) &&
        props.departureTarget
      )
        this.renderer.flyCard(this, entry.image, props.departureTarget);
      if (this.drag?.entry === entry || this.settling?.entry === entry) this.abort();
      else if (this.renderer.isLifted(entry.root)) this.renderer.restoreCard(this, entry.root);
      this.killEntry(entry);
      entry.root.removeFromParent();
      entry.root.destroy({ children: true, texture: false, textureSource: false });
      this.entries.delete(id);
      if (this.hoveredId === id) this.hoveredId = null;
    }
    const theme = getTheme();
    for (const [index, cell] of visible.entries()) {
      let entry = this.entries.get(cell.card.id);
      const created = !entry;
      if (!entry) entry = this.createEntry(cell);
      if (
        (this.drag?.entry === entry ||
          this.settling?.entry === entry ||
          this.renderer.isLifted(entry.root)) &&
        this.cellChanged(entry.cell, cell)
      )
        this.abort();
      if (this.renderer.isLifted(entry.root) && this.cellChanged(entry.cell, cell))
        this.renderer.restoreCard(this, entry.root);
      if (newArrival || scrollChanged) this.finishEntry(entry);
      this.placeEntry(
        entry,
        cell,
        created || scrollChanged || freshDeal || (newArrival && props.opening),
      );
      entry.image.width = cell.width;
      entry.image.height = cell.height;
      entry.label.style.fill = theme.appTheme.foreground;
      entry.label.style.wordWrapWidth = cell.width - 12;
      entry.label.position.set(6, cell.height / 2 - entry.label.height / 2);
      const selected = props.selectedIds.includes(cell.card.id);
      entry.frame
        .clear()
        .roundRect(0, 0, cell.width, cell.height, 6)
        .fill(hexToNum(theme.appTheme.muted))
        .stroke({
          color: hexToNum(selected ? theme.gameTheme.cardSelection : theme.appTheme.border),
          width: selected ? 4 : 1,
        });
      entry.image.alpha = props.disabled ? 0.65 : 1;
      if (!props.opening && freshDeal && props.arrivalKey) this.deal(entry, index);
      else if (!props.opening && !props.arrivalKey && created && addedIds.has(cell.card.id))
        this.settle(entry, index);
      this.updatePose(entry);
      if (entry.locale !== useScryfallStore.getState().locale && !entry.loading)
        void this.load(entry);
    }
    for (const child of this.headings.removeChildren()) child.destroy();
    for (const header of props.layout.headers) {
      if (header.y < props.scrollTop - 32 || header.y > props.scrollTop + props.height) continue;
      const text = new Text({
        text: header.label,
        style: {
          fontFamily: "Alegreya Sans",
          fontSize: 16,
          fontWeight: "bold",
          fill: theme.appTheme["muted-foreground"],
        },
      });
      text.position.set(header.x, header.y - props.scrollTop);
      this.headings.addChild(text);
    }
    if (newArrival) {
      this.arrivalKey = props.arrivalKey;
      if (props.opening) {
        for (const entry of this.entries.values()) this.finishEntry(entry);
        this.reveal.play(
          visible.map((cell) => ({
            motion: this.entries.get(cell.card.id)!.motion,
            ...cell,
            y: cell.y - props.scrollTop,
          })),
          props.width,
          props.height,
        );
        for (const entry of this.entries.values()) this.updatePose(entry, false);
      }
      this.revealing = this.reveal.active;
    }
    this.knownIds = allIds;
    this.acquiredIds = acquiredIds;
    for (const id of this.acceptedIds) {
      if (!allIds.has(id) || !acquiredIds.has(id)) this.acceptedIds.delete(id);
    }
    this.hasLayout = true;
    this.request();
  }
  private createEntry(cell: LimitedCell): CardEntry {
    const theme = getTheme();
    const root = new Container();
    const motion = new Container();
    const pose = new Container();
    const image = new Sprite();
    const frame = new Graphics()
      .roundRect(0, 0, cell.width, cell.height, 6)
      .fill(hexToNum(theme.appTheme.muted))
      .stroke({ color: hexToNum(theme.gameTheme.cardSelection), width: 4 });
    const label = new Text({
      text: cell.card.name,
      style: {
        fontFamily: "Alegreya Sans",
        fontSize: 13,
        fill: theme.appTheme.foreground,
        wordWrap: true,
        wordWrapWidth: cell.width - 12,
      },
    });
    root.addChild(motion);
    motion.addChild(pose);
    pose.addChild(frame, image, label);
    this.root.addChild(root);
    image.width = cell.width;
    image.height = cell.height;
    label.position.set(6, cell.height / 2 - label.height / 2);
    const entry: CardEntry = {
      cell,
      root,
      motion,
      pose,
      image,
      frame,
      label,
      locale: "",
      loading: false,
      layoutTimeline: null,
      motionTimeline: null,
      poseTimeline: null,
      poseLift: 0,
      poseRotation: 0,
      poseScale: 1,
    };
    this.entries.set(cell.card.id, entry);
    this.placeEntry(entry, cell, true);
    return entry;
  }
  private cellChanged(previous: LimitedCell, cell: LimitedCell): boolean {
    return (
      previous.x !== cell.x ||
      previous.y !== cell.y ||
      previous.width !== cell.width ||
      previous.height !== cell.height
    );
  }
  private placeEntry(entry: CardEntry, cell: LimitedCell, snap: boolean): void {
    const previous = entry.cell;
    const changed = this.cellChanged(previous, cell);
    entry.cell = cell;
    if (this.renderer.isLifted(entry.root)) return;
    if (changed || snap) {
      entry.pose.pivot.set(cell.width / 2, cell.height / 2);
      entry.pose.x = cell.width / 2;
      this.updatePose(entry, false);
    }
    if (!snap && !changed) return;
    entry.layoutTimeline?.kill();
    entry.layoutTimeline = null;
    if (snap || !animationsEnabled() || this.drag?.entry === entry || this.reveal.active) {
      entry.root.position.set(cell.x, cell.y - this.props.scrollTop);
      entry.root.scale.set(1);
      return;
    }
    entry.root.scale.set(
      (entry.root.scale.x * previous.width) / cell.width,
      (entry.root.scale.y * previous.height) / cell.height,
    );
    const timeline = gsap.timeline({
      onUpdate: this.request,
      onComplete: () => {
        entry.layoutTimeline = null;
        this.request();
      },
    });
    entry.layoutTimeline = timeline;
    timeline.to(entry.root, {
      x: cell.x,
      y: cell.y - this.props.scrollTop,
      duration: REFLOW_DURATION,
      ease: "power2.out",
    });
    timeline.to(entry.root.scale, { x: 1, y: 1, duration: REFLOW_DURATION, ease: "power2.out" }, 0);
  }
  private deal(entry: CardEntry, index: number): void {
    if (!animationsEnabled()) return;
    const direction = this.props.arrivalDirection === "left" ? -1 : 1;
    entry.motion.position.set(
      direction * Math.min(this.props.width * 0.42, entry.cell.width * 2),
      -entry.cell.height * 0.09,
    );
    entry.motion.rotation = direction * 0.04;
    entry.motion.scale.set(0.96);
    entry.motion.alpha = 0;
    this.arrive(entry, DEAL_DURATION, Math.min(index * DEAL_STAGGER, DEAL_STAGGER_LIMIT));
  }
  private settle(entry: CardEntry, index: number): void {
    if (!animationsEnabled()) return;
    entry.motion.position.set(0, -Math.min(entry.cell.height * 0.18, 30));
    entry.motion.scale.set(0.94);
    entry.motion.rotation = -0.025;
    entry.motion.alpha = 0;
    this.arrive(
      entry,
      POOL_SETTLE_DURATION,
      POOL_SETTLE_DELAY + Math.min(index * DEAL_STAGGER, DEAL_STAGGER_LIMIT),
    );
  }
  private arrive(entry: CardEntry, duration: number, delay: number): void {
    entry.motionTimeline?.kill();
    const timeline = gsap.timeline({
      onUpdate: this.request,
      onComplete: () => {
        entry.motionTimeline = null;
        this.request();
      },
    });
    entry.motionTimeline = timeline;
    timeline.to(
      entry.motion,
      { x: 0, y: 0, rotation: 0, alpha: 1, duration, ease: "power3.out" },
      delay,
    );
    timeline.to(entry.motion.scale, { x: 1, y: 1, duration, ease: "power3.out" }, delay);
  }
  private updatePose(entry: CardEntry, animate = true): void {
    const interactive =
      !this.props.disabled &&
      !this.reveal.active &&
      this.drag?.entry !== entry &&
      this.settling?.entry !== entry &&
      !this.renderer.isLifted(entry.root);
    const hovered = interactive && this.hoveredId === entry.cell.card.id;
    const selected = interactive && this.props.selectedIds.includes(entry.cell.card.id);
    const lift = hovered ? HOVER_LIFT : selected ? SELECTED_LIFT : 0;
    const rotation = hovered ? HOVER_TILT : 0;
    const scale = hovered ? HOVER_SCALE : selected ? SELECTED_SCALE : 1;
    entry.root.zIndex =
      this.drag?.entry === entry && this.drag.active ? 3 : hovered ? 2 : selected ? 1 : 0;
    if (
      animate &&
      animationsEnabled() &&
      entry.poseLift === lift &&
      entry.poseRotation === rotation &&
      entry.poseScale === scale
    )
      return;
    entry.poseTimeline?.kill();
    entry.poseTimeline = null;
    entry.poseLift = lift;
    entry.poseRotation = rotation;
    entry.poseScale = scale;
    const y = entry.cell.height / 2 - lift;
    if (!animate || !animationsEnabled()) {
      entry.pose.y = y;
      entry.pose.rotation = rotation;
      entry.pose.scale.set(scale);
      return;
    }
    const timeline = gsap.timeline({
      onUpdate: this.request,
      onComplete: () => {
        entry.poseTimeline = null;
        this.request();
      },
    });
    entry.poseTimeline = timeline;
    timeline.to(entry.pose, { y, rotation, duration: POSE_DURATION, ease: "power2.out" });
    timeline.to(
      entry.pose.scale,
      { x: scale, y: scale, duration: POSE_DURATION, ease: "power2.out" },
      0,
    );
  }
  private killEntry(entry: CardEntry): void {
    entry.layoutTimeline?.kill();
    entry.motionTimeline?.kill();
    entry.poseTimeline?.kill();
    entry.layoutTimeline = null;
    entry.motionTimeline = null;
    entry.poseTimeline = null;
  }
  private finishEntry(entry: CardEntry): void {
    this.killEntry(entry);
    if (this.renderer.isLifted(entry.root)) return;
    entry.root.pivot.set(0);
    entry.root.rotation = 0;
    entry.root.skew.set(0);
    entry.root.position.set(entry.cell.x, entry.cell.y - this.props.scrollTop);
    entry.root.scale.set(1);
    if (this.drag?.entry !== entry || !this.drag.active) {
      entry.motion.position.set(0, 0);
      entry.motion.scale.set(1);
      entry.motion.rotation = 0;
      entry.motion.alpha = 1;
    }
    this.updatePose(entry, false);
  }
  private finishAnimations(): void {
    if (this.reveal.active) this.reveal.finish();
    this.finishSettling();
    for (const entry of this.entries.values()) {
      if (entry.layoutTimeline || entry.motionTimeline || entry.poseTimeline)
        this.finishEntry(entry);
    }
    this.renderer.cancelFlights(this);
  }
  private async load(entry: CardEntry): Promise<void> {
    entry.loading = true;
    const locale = useScryfallStore.getState().locale;
    entry.locale = locale;
    try {
      const { info, uris } = await useScryfallStore.getState().getCard({
        name: entry.cell.card.name,
        setCode: entry.cell.card.setCode,
        collectorNumber: entry.cell.card.cardNumber,
      });
      const deckCard = scryfallToDeckCard({ ...info, image_uris: info.image_uris ?? uris });
      deckCard.identity = { ...deckCard.identity, ...entry.cell.card };
      const texture = await useScryfallStore.getState().getCardTexture(deckCard, "full", 0);
      if (this.disposed || entry.root.destroyed || locale !== useScryfallStore.getState().locale)
        return;
      entry.image.texture = texture;
      entry.image.width = entry.cell.width;
      entry.image.height = entry.cell.height;
      entry.label.visible = texture.width <= 1;
    } catch {
      if (!entry.root.destroyed) entry.label.text = `${entry.cell.card.name}\nImage unavailable`;
    } finally {
      entry.loading = false;
      this.request();
      if (!this.disposed && !entry.root.destroyed && locale !== useScryfallStore.getState().locale)
        void this.load(entry);
    }
  }
  pressMarquee(event: PointerEvent): void {
    if (
      !this.props.onSelectMany ||
      this.props.disabled ||
      this.drag ||
      this.reveal.active ||
      event.button !== 0 ||
      event.pointerType === "touch"
    )
      return;
    this.finishSettling();
    this.marqueePointerId = event.pointerId;
    this.marquee.setColor(hexToNum(getTheme().gameTheme.cardSelection));
    this.marquee.start(
      event.clientX,
      event.clientY,
      event.ctrlKey || event.metaKey || event.shiftKey,
    );
    this.renderer.addOverlay(this.marquee.graphics);
    this.props.onInspect(null, false);
  }
  cardPositions(): Map<string, MarqueeCardPosition> {
    const positions = new Map<string, MarqueeCardPosition>();
    if (!this.props.onSelectMany || this.props.disabled) return positions;
    for (const [id, entry] of this.entries) {
      const transform = entry.root.getGlobalTransform();
      const center = transform.apply({ x: entry.cell.width / 2, y: entry.cell.height / 2 });
      positions.set(id, {
        x: center.x,
        y: center.y,
        width: entry.cell.width * Math.hypot(transform.a, transform.b),
        height: entry.cell.height * Math.hypot(transform.c, transform.d),
      });
    }
    return positions;
  }
  dragCards(ids: readonly string[]): Container[] {
    if (this.props.disabled || this.reveal.active) return [];
    const roots: Container[] = [];
    for (const id of ids) {
      let entry = this.entries.get(id);
      if (!entry) {
        const cell = this.props.layout.cells.find((candidate) => candidate.card.id === id);
        if (!cell) continue;
        entry = this.createEntry(cell);
        void this.load(entry);
      }
      if (this.renderer.isLifted(entry.root)) continue;
      this.finishEntry(entry);
      entry.root.pivot.set(entry.cell.width / 2, entry.cell.height / 2);
      entry.root.position.set(
        entry.cell.x + entry.cell.width / 2,
        entry.cell.y - this.props.scrollTop + entry.cell.height / 2,
      );
      roots.push(entry.root);
    }
    return roots;
  }
  restoreDragCard(root: Container): void {
    for (const entry of this.entries.values()) {
      if (entry.root === root) {
        this.finishEntry(entry);
        break;
      }
    }
  }
  pressCard(id: string, event: PointerEvent): void {
    const entry = this.entries.get(id);
    if (!entry || this.props.disabled || this.drag || event.button !== 0 || this.reveal.active)
      return;
    this.finishSettling();
    this.longPress.reset();
    this.drag = {
      pointerId: event.pointerId,
      entry,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      pointerType: event.pointerType,
      additive: event.ctrlKey || event.metaKey || event.shiftKey,
      target: event.target,
      table: this.host.closest("[data-limited-table]"),
      inspected: false,
      targetX: 0,
      targetY: 0,
      lastX: event.clientX,
      lastY: event.clientY,
      targetRotation: 0,
      restRotation: 0,
      restScaleX: 1,
      restScaleY: 1,
      dropZone: null,
      settleTimeline: null,
    };
    this.finishEntry(entry);
    this.longPress.start(
      { pointerType: event.pointerType, global: { x: event.clientX, y: event.clientY } },
      entry.cell.card.id,
      () => {
        const drag = this.drag;
        if (!drag || drag.entry !== entry || drag.active) return;
        drag.inspected = true;
        this.lastTap = null;
        this.props.onInspect(entry.cell.card, true);
      },
    );
  }
  hoverCard(id: string | null, pointerType: string): void {
    if (pointerType !== "mouse" || this.drag || this.reveal.active) return;
    const previous = this.hoveredId ? this.entries.get(this.hoveredId) : null;
    const entry = id ? this.entries.get(id) : null;
    this.hoveredId = entry?.cell.card.id ?? null;
    if (previous && previous !== entry) this.updatePose(previous);
    if (entry) this.updatePose(entry);
    if (entry || !id) this.props.onInspect(entry?.cell.card ?? null, false);
    this.request();
  }
  inspectCard(id: string): void {
    const card = this.props.layout.cells.find((cell) => cell.card.id === id)?.card;
    if (card) {
      this.abort();
      this.props.onInspect(card, true);
    }
  }
  private readonly move = (event: PointerEvent): void => {
    if (this.marqueePointerId === event.pointerId) {
      this.marquee.move(event.clientX, event.clientY);
      if (event.cancelable) event.preventDefault();
      this.request();
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId || drag.inspected) return;
    this.longPress.move(event.clientX, event.clientY);
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (
      drag.pointerType === "touch" &&
      !this.props.onDrop &&
      !drag.active &&
      Math.abs(dy) > Math.abs(dx) &&
      Math.abs(dy) > LIMITED_DRAG_THRESHOLD
    ) {
      this.abort();
      return;
    }
    if (!drag.active && this.props.onDrop && Math.hypot(dx, dy) > LIMITED_DRAG_THRESHOLD) {
      const { entry } = drag;
      this.longPress.cancel();
      this.finishEntry(entry);
      entry.root.pivot.set(entry.cell.width / 2, entry.cell.height / 2);
      entry.root.position.set(
        entry.cell.x + entry.cell.width / 2,
        entry.cell.y - this.props.scrollTop + entry.cell.height / 2,
      );
      if (!drag.table?.isConnected || !this.renderer.liftCard(this, entry.root)) {
        this.abort();
        return;
      }
      drag.active = true;
      drag.targetX = entry.root.x;
      drag.targetY = entry.root.y;
      drag.restRotation = entry.root.rotation;
      drag.targetRotation = drag.restRotation;
      drag.restScaleX = entry.root.scale.x;
      drag.restScaleY = entry.root.scale.y;
      if (this.props.selectedIds.includes(entry.cell.card.id))
        this.renderer.liftSelection(this, entry.root, this.props.selectedIds);
      this.hoveredId = null;
      this.lastTap = null;
      this.props.onInspect(null, false);
    }
    if (!drag.active) return;
    if (event.cancelable) event.preventDefault();
    drag.targetX += event.clientX - drag.lastX;
    drag.targetY += event.clientY - drag.lastY;
    drag.targetRotation = drag.restRotation + dragTiltForMovement(event.clientX - drag.lastX);
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!animationsEnabled()) this.updateDragMotion(0);
    this.setDropZone(drag, this.findDropZone(drag, event.clientX, event.clientY));
    this.request();
  };
  private readonly release = (event: PointerEvent): void => {
    if (this.marqueePointerId === event.pointerId) {
      this.marqueePointerId = null;
      this.marquee.move(event.clientX, event.clientY);
      const ids = this.marquee.end(
        this.renderer.marqueePositions(this),
        new Set(this.props.selectedIds),
      );
      this.props.onSelectMany?.([...ids]);
      this.request();
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const held = this.longPress.consumeTap(drag.entry.cell.card.id);
    this.longPress.reset();
    this.drag = null;
    this.setDropZone(drag, null);
    if (drag.active) {
      this.lastTap = null;
      const zone =
        !held && !this.props.disabled && this.props.onDrop
          ? this.findDropZone(drag, event.clientX, event.clientY)
          : null;
      this.settleDrag(drag);
      if (zone) this.props.onDrop?.(drag.entry.cell.card, event.clientX, event.clientY);
      return;
    }
    this.finishEntry(drag.entry);
    this.request();
    if (held || drag.inspected || this.props.disabled || event.target !== drag.target) return;
    const now = performance.now();
    if (
      this.lastTap?.id === drag.entry.cell.card.id &&
      now - this.lastTap.time < 350 &&
      this.props.onActivate
    ) {
      this.props.onActivate(drag.entry.cell.card);
      this.lastTap = null;
    } else {
      this.props.onSelect?.(drag.entry.cell.card, drag.additive);
      this.lastTap = { id: drag.entry.cell.card.id, time: now };
    }
  };
  private updateDragMotion(deltaMs: number): void {
    const drag = this.drag;
    if (!drag?.active) return;
    const root = drag.entry.root;
    if (!animationsEnabled()) {
      root.position.set(drag.targetX, drag.targetY);
      root.rotation = drag.restRotation;
      root.scale.set(drag.restScaleX, drag.restScaleY);
      this.renderer.updateSelection(root, deltaMs);
      return;
    }
    const positionBlend = dragPositionBlend(deltaMs);
    const transformBlend = dragTransformBlend(deltaMs);
    root.position.set(
      root.x + (drag.targetX - root.x) * positionBlend,
      root.y + (drag.targetY - root.y) * positionBlend,
    );
    root.scale.set(
      root.scale.x + (drag.restScaleX * DRAG_LIFT_SCALE - root.scale.x) * transformBlend,
      root.scale.y + (drag.restScaleY * DRAG_LIFT_SCALE - root.scale.y) * transformBlend,
    );
    root.rotation += (drag.targetRotation - root.rotation) * transformBlend;
    drag.targetRotation =
      drag.restRotation + (drag.targetRotation - drag.restRotation) * (1 - transformBlend);
    this.renderer.updateSelection(root, deltaMs);
  }
  private findDropZone(drag: Drag, x: number, y: number): Element | null {
    if (
      !drag.table?.isConnected ||
      !drag.table.contains(this.host) ||
      drag.table !== this.host.closest("[data-limited-table]") ||
      x < 0 ||
      y < 0 ||
      x >= window.innerWidth ||
      y >= window.innerHeight
    )
      return null;
    const zone = document.elementFromPoint(x, y)?.closest("[data-limited-zone]");
    if (!zone || !drag.table.contains(zone)) return null;
    const id = zone.getAttribute("data-limited-zone");
    return id === "pool" || id === "main" || id === "sideboard" || id === "maybe" ? zone : null;
  }
  private setDropZone(drag: Drag, zone: Element | null): void {
    if (drag.dropZone === zone) return;
    drag.dropZone?.removeAttribute("data-limited-drop-active");
    drag.dropZone = zone;
    zone?.setAttribute("data-limited-drop-active", "true");
  }
  private settleDrag(drag: Drag): void {
    this.settling = drag;
    if (!animationsEnabled()) {
      this.finishSettling();
      return;
    }
    const { entry } = drag;
    const center = this.root.toGlobal({
      x: entry.cell.x + entry.cell.width / 2,
      y: entry.cell.y - this.props.scrollTop + entry.cell.height / 2,
    });
    const timeline = gsap.timeline({
      onUpdate: this.request,
      onComplete: () => {
        if (this.settling === drag) this.finishSettling();
      },
    });
    drag.settleTimeline = timeline;
    this.renderer.settleSelection(entry.root, timeline, REFLOW_DURATION);
    timeline.to(
      entry.root,
      {
        x: center.x,
        y: center.y,
        rotation: drag.restRotation,
        duration: REFLOW_DURATION,
        ease: "power3.out",
      },
      0,
    );
    timeline.to(
      entry.root.scale,
      {
        x: drag.restScaleX,
        y: drag.restScaleY,
        duration: REFLOW_DURATION,
        ease: "power3.out",
      },
      0,
    );
    this.request();
  }
  private finishSettling(): void {
    const drag = this.settling;
    if (!drag) return;
    this.settling = null;
    drag.settleTimeline?.kill();
    drag.settleTimeline = null;
    this.renderer.restoreCard(this, drag.entry.root);
    if (!drag.entry.root.destroyed) this.finishEntry(drag.entry);
    this.request();
  }
  private readonly cancelPointer = (event: PointerEvent): void => {
    if (event.pointerId === this.marqueePointerId) this.abort();
    if (event.pointerId === this.drag?.pointerId || event.pointerId === this.settling?.pointerId)
      this.abort();
  };
  readonly abort = (): void => {
    this.marqueePointerId = null;
    this.marquee.cancel();
    this.longPress.reset();
    const drag = this.drag;
    this.drag = null;
    this.lastTap = null;
    if (drag) {
      this.setDropZone(drag, null);
      this.renderer.restoreCard(this, drag.entry.root);
      if (!drag.entry.root.destroyed) this.finishEntry(drag.entry);
    }
    this.finishSettling();
    this.request();
  };
  private readonly visibilityChanged = (): void => {
    if (document.hidden) this.abort();
  };
  private readonly request = (): void => {
    this.renderer?.request();
  };
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort();
    this.reveal.finish();
    this.marquee.destroy();
    for (const entry of this.entries.values()) this.killEntry(entry);
    this.unsubscribeTheme?.();
    this.unsubscribeStore?.();
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.release);
    window.removeEventListener("pointercancel", this.cancelPointer);
    window.removeEventListener("blur", this.abort);
    window.removeEventListener("scroll", this.abort, true);
    window.removeEventListener("resize", this.abort);
    window.visualViewport?.removeEventListener("scroll", this.abort);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.renderer.release(this);
    this.root.destroy({ children: true, texture: false, textureSource: false });
    this.entries.clear();
    this.knownIds.clear();
    this.acquiredIds.clear();
    this.acceptedIds.clear();
  }
}

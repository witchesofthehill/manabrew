import {
  Application,
  Container,
  Graphics,
  Text,
  FederatedPointerEvent,
  Sprite,
  type Texture,
} from "pixi.js";
import type { GameCard } from "@/types/manabrew";
import type {
  ArrowSpec,
  ArrowEndpoint,
  CastingArrowSpec,
  GameCanvasCallbacks,
  BattlefieldState,
  HandState,
  PlayZoneRect,
  ScreenPos,
  ScreenBounds,
} from "./types";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "./colorUtils";
import {
  applyCardOverrides,
  useGameDevStore,
  DEBUG_KEYWORD_CARD_ID,
} from "@/stores/useGameDevStore";
import { CardSprite, setCardSpriteTheme } from "./CardSprite";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { MarqueeHandler } from "./MarqueeHandler";
import { DragHandler } from "./DragHandler";
import {
  computeGridLayout,
  cellAt,
  cellFromPoint,
  cellsByDistance,
  cellKey,
  type GridCell,
  type GridLayoutInfo,
} from "./GridLayout";
import { computeBaseLayout, computeHandLayout, HAND_FAN_PARAMS } from "./HandLayout";
import { ArrowLayer, type ArrowDef } from "./ArrowLayer";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { extractManaLetters, getExpandedManaAbilities } from "@/components/game/manaUtils";
import {
  getManaSymbolTextureSync,
  loadManaSymbolTexture,
  prewarmManaSymbols,
} from "./manaSymbolCache";
import { manaColorFor } from "./manaColors";
import {
  ATTACH_OFFSET_Y,
  BATTLEFIELD_CARD_SCALE_DEFAULT,
  OPPONENT_PANEL_FULLWIDTH_FRAC,
  BATTLEFIELD_HOVER_HOLD_MS,
  BATTLEFIELD_LERP,
  BG_ALPHA_DROP,
  BG_ALPHA_IDLE,
  CARD_RADIUS,
  GAP,
  GHOST_FILL_ALPHA,
  GHOST_STROKE_ALPHA,
  GRID_SKELETON_FILL_ALPHA,
  GRID_SKELETON_HOVER_ALPHA,
  GRID_SKELETON_STACK_ALPHA,
  GRID_SKELETON_STACK_FILL_ALPHA,
  GRID_SKELETON_STROKE_ALPHA,
  HAND_HOVER_HOLD_MS,
  HAND_LERP,
  HOVER_SCALE,
  HOVER_SCALE_LERP,
  ICON_BG_ALPHA,
  ICON_HOVER_SCALE,
  MANA_BUTTON_ALPHA,
  MANA_BUTTON_HOVER_ALPHA,
  MANA_BUTTON_STROKE_ALPHA,
  MANA_BUTTON_STROKE_HOVER_ALPHA,
  MAX_GRID_SLOTS,
  MAX_LAND_SLOTS,
  OVERLAY_FADE_LERP,
  OVERLAY_LABEL_SELECT,
  OVERLAY_LABEL_TAP,
  OVERLAY_LABEL_UNTAP,
  SYMBOL_TAP,
  SYMBOL_UNTAP,
  PLAYABLE_HIGHLIGHT_ALPHA,
  PLAYABLE_RING_ALPHA,
  ROTATION_LERP,
  ACTION_BUTTON_ALPHA,
  ACTION_BUTTON_HOVER_ALPHA,
  SELECT_BUTTON_ALPHA,
  SELECT_BUTTON_HOVER_ALPHA,
  SNAP_ALPHA,
  SNAP_HAND_SCALE,
  SNAP_PX,
  SNAP_ROT,
  SNAP_SCALE,
  STACK_SEED_TTL_MS,
  TABLE_RADIUS,
  Z_GRID_SKELETON,
  Z_HAND_CONTAINER,
  Z_HAND_HOVERED,
  Z_OVERLAY_OFFSET,
  Z_PLACEMENT_GHOST,
  Z_PLACEMENT_GHOST_TEXT,
  Z_SELECTION_BADGE,
} from "./constants";
import {
  EMPTY_LABEL_STYLE,
  GHOST_LABEL_STYLE,
  OVERLAY_LABEL_STYLE,
  SELECTION_BADGE_STYLE,
} from "./textStyles";

// ───── Shared types ─────
type Point = ScreenPos;

interface SpriteEntry {
  sprite: CardSprite;
  targetX: number;
  targetY: number;
  targetZIndex: number;
  targetRotation: number;
  etbGlowAlpha: number;
  overlay: Container | null;
}

interface HandTarget {
  x: number;
  y: number;
  rot: number;
  scaleX: number;
  scaleY: number;
  zIndex: number;
}

interface HandHitZone {
  index: number;
  card: GameCard;
  x: number;
  y: number;
  width: number;
  height: number;
}

const HAND_SELECTION_DROP_PX = 30;
const CAST_DRAG_SCALE = 1.25;
const CAST_DRAG_CARD_DROP_PX = 16;
const CAST_DRAG_HAND_SINK_PX = 200;
const CAST_DRAG_HIGHLIGHT_ALPHA = 0.55;

interface ActionKind {
  isTappable: boolean;
  isUntappable: boolean;
  isSelectable: boolean;
}

// ───── Pure helpers ─────
/**
 * Destroy a Pixi display object without cascading into children. Pixi v8
 * hits a `TexturePool.returnTexture` crash when destroying certain Text
 * objects (the pool's internal key-to-pool map sometimes lacks the slot
 * for a given key, and `push` is called on undefined). Dropping our own
 * reference is enough — the display object detaches from its parent via
 * its own destroy, and the leaked Text children get garbage-collected
 * once the Pixi Application is disposed. Wrapped in try/catch so a Pixi
 * internal bug never crashes the React tree during game teardown.
 */
const safeDestroy = (obj: { destroy: (...args: never[]) => void }): void => {
  try {
    obj.destroy();
  } catch (err) {
    console.warn("[pixi] display-object destroy threw:", err);
  }
};

const lerp = (current: number, target: number, speed: number, snap: number): number => {
  const d = target - current;
  return Math.abs(d) > snap ? current + d * speed : target;
};

export interface BlockingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Optional feature flags controlling which subsystems this scene runs.
 * Opponent-side canvases opt out of the hand, drag, marquee, and stacking
 * behaviors entirely; a mirrored scene also flips the auto-placement
 * anchors so lands appear at the top and non-lands fill downward.
 */
export interface PixiSceneOptions {
  /** When true, tapped cards rotate counter-clockwise, lands auto-place
   *  at the top of the zone, and non-lands fill from the bottom upward.
   *  Used for every opponent's half of the board. */
  mirrored?: boolean;
  /** Render the hand fan at the bottom of the zone. Default true. */
  showHand?: boolean;
  /** Enable free drag, grid snapping, stacking, and marquee selection on
   *  battlefield sprites. Default true. */
  allowDrag?: boolean;
}

export class PixiGameScene {
  app: Application;
  private mirrored: boolean;
  private showHand: boolean;
  private allowDrag: boolean;
  private root: Container;
  private myBattlefieldContainer: Container;
  private backgroundGfx: Graphics;
  private entries = new Map<string, SpriteEntry>();
  private callbacks: GameCanvasCallbacks;
  // Seeded synchronously from the active preset so every draw call can
  // read theme colours without nullability checks — `setTheme` then keeps
  // it in sync with live preset / overrides changes.
  private theme: Theme = getTheme();
  private leftReserved = 0;
  private hoveredCardId: string | null = null;
  private castDragActive = false;
  private battlefieldHoverClearTimer: number | null = null;
  /** Extra blocker rects (in canvas-local coords) — e.g. the PASS / phase-pass
   * button cluster at the bottom-right so lands aren't placed under it. */
  private externalBlockers: BlockingRect[] = [];
  /** Keep-out size anchored to the bottom-right of the canvas (recomputed
   * from current renderer dimensions so the rect stays valid after resize). */
  private bottomRightReserved: { width: number; height: number } | null = null;
  /** Keep-out size anchored to the bottom-left of the canvas — the player
   *  panel cluster (avatar + zones + mana). Replaces the old global
   *  `leftReserved` approach so the grid can fill the full width for rows
   *  above the panel. */
  private bottomLeftReserved: { width: number; height: number } | null = null;
  /** Keep-out box at the top-left for the opponent panel cluster — only the
   *  panel's footprint is reserved, so the lands row still fills the rest of
   *  the top edge. */
  private topLeftReserved: { width: number; height: number } | null = null;
  private lastReportedHeight = 0;
  /**
   * Set in `destroy()` so any late-firing effects (React unmount races) that
   * still hold a reference to this instance short-circuit instead of touching
   * a partially-torn-down Pixi display tree.
   */
  private destroyed = false;
  private dropActive = false;
  /** Grid cell the user was hovering when they dropped a card from hand.
   *  The next new card entering the battlefield gets this slot. */
  private pendingDropSlot: { col: number; row: number } | null = null;
  private selectedCardIds = new Set<string>();
  private marquee: MarqueeHandler;
  private dragHandler: DragHandler;
  /** User-assigned grid slot per top-level battlefield card. Survives re-renders
   *  so a card stays put once the user drops it on a cell. Pruned when the
   *  card leaves the battlefield. */
  private userSlots = new Map<string, { col: number; row: number }>();
  /** UI-only parent mapping: child id → parent id. Merged with engine
   *  attachments (`card.attachedTo`) when computing the effective tree. */
  private uiParent = new Map<string, string>();
  private stackCounts = new Map<string, number>();
  private nameGroupChildren = new Set<string>();
  private userPlacedCards = new Set<string>();
  /** Latest grid layout — cached per frame so drag/stack hit-tests and the
   *  skeleton overlay share the same cell geometry. */
  private gridInfo: GridLayoutInfo | null = null;
  /** Cell-center target coords per top-level card id, derived from the
   *  grid each `updateBattlefield` call. Dragged sprites override this via
   *  `entry.targetX/Y`. */
  private gridTargets = new Map<string, Point>();
  /** While a drag is in progress, the cell the dragged card is pointing at
   *  (for the skeleton highlight). Null when not dragging or out of range. */
  private hoveredCell: GridCell | null = null;
  /** GameCard id the dragged sprite would stack onto if released now. */
  private stackTargetId: string | null = null;
  private gridSkeletonGfx: Graphics;
  private cardScale = BATTLEFIELD_CARD_SCALE_DEFAULT;
  private lastState: BattlefieldState | null = null;
  private emptyText: Text;
  private selectionBadge: Text;

  private handContainer: Container;
  private handSprites = new Map<string, CardSprite>();
  private handTargets = new Map<string, HandTarget>();
  private handHitZones: HandHitZone[] = [];
  private hoveredHandIndex: number | null = null;
  private handHoverHoldTimer: number | null = null;
  private pendingHandHoverLeaveIndex: number | null = null;
  private lastHandState: HandState | null = null;
  private vScale = 1;
  private arrowLayer: ArrowLayer;
  /** Current arrow specs. Resolved to canvas-local ArrowDefs every tick so
   *  arrows follow animating sprites (hand lift, battlefield re-layout). */
  private arrowSpecs: ArrowSpec[] = [];
  /**
   * Sub-rectangle of the canvas where battlefield + hand sprites live. The
   * canvas itself may be larger (covering the full board so arrows span
   * both halves). When null, the full canvas is used.
   */
  private playZone: PlayZoneRect | null = null;
  /** Casting arrow (cursor-follow during target prompts). */
  private castingArrow: CastingArrowSpec | null = null;
  /** Latest viewport cursor position (window coords). Used for the casting
   *  arrow's free endpoint when no target is locked. */
  private cursorViewportX = 0;
  private cursorViewportY = 0;
  private cursorListener: ((e: MouseEvent) => void) | null = null;
  private canvasLeaveListener: ((e: PointerEvent) => void) | null = null;
  private devOverridesUnsub: (() => void) | null = null;
  private placementGhostGfx: Graphics | null = null;
  private placementGhostText: Text | null = null;
  /**
   * Last observed DOM position of each stack card (canvas-local center +
   * rendered size), refreshed every tick and retained for STACK_SEED_TTL_MS
   * after the card leaves the stack so a newly-spawned battlefield sprite
   * for a just-resolved spell can animate from its stack position instead
   * of from the hand.
   */
  private stackCardSeeds = new Map<string, { x: number; y: number; scale: number; ts: number }>();

  constructor(app: Application, callbacks: GameCanvasCallbacks, options: PixiSceneOptions = {}) {
    this.app = app;
    this.callbacks = callbacks;
    this.mirrored = options.mirrored ?? false;
    this.showHand = options.showHand ?? true;
    this.allowDrag = options.allowDrag ?? true;

    this.root = new Container();
    app.stage.addChild(this.root);

    this.backgroundGfx = new Graphics();
    this.root.addChild(this.backgroundGfx);

    this.myBattlefieldContainer = new Container();
    this.myBattlefieldContainer.label = "myBattlefield";
    this.myBattlefieldContainer.sortableChildren = true;
    this.root.addChild(this.myBattlefieldContainer);

    this.emptyText = new Text({
      text: "No permanents",
      style: EMPTY_LABEL_STYLE,
    });
    this.emptyText.anchor.set(0.5);
    this.emptyText.visible = false;
    this.root.addChild(this.emptyText);

    this.marquee = new MarqueeHandler();
    this.root.addChild(this.marquee.graphics);

    this.dragHandler = new DragHandler();
    this.dragHandler.setCardScale(this.cardScale);

    this.gridSkeletonGfx = new Graphics();
    this.gridSkeletonGfx.eventMode = "none";
    this.gridSkeletonGfx.visible = false;
    this.gridSkeletonGfx.zIndex = Z_GRID_SKELETON;
    this.myBattlefieldContainer.addChild(this.gridSkeletonGfx);

    this.selectionBadge = new Text({ text: "", style: SELECTION_BADGE_STYLE });
    this.selectionBadge.visible = false;
    this.selectionBadge.zIndex = Z_SELECTION_BADGE;
    this.root.addChild(this.selectionBadge);

    this.handContainer = new Container();
    this.handContainer.label = "hand";
    this.handContainer.sortableChildren = true;
    this.handContainer.zIndex = Z_HAND_CONTAINER;
    this.root.addChild(this.handContainer);

    this.arrowLayer = new ArrowLayer();
    this.root.addChild(this.arrowLayer.graphics);

    this.backgroundGfx.eventMode = "static";
    this.backgroundGfx.on("pointerdown", (e: FederatedPointerEvent) => this.onBackgroundDown(e));
    app.stage.on("pointermove", (e: FederatedPointerEvent) => this.onGlobalMove(e));
    app.stage.on("pointerup", () => this.onGlobalUp());
    app.stage.on("pointerupoutside", () => this.onGlobalUp());
    app.stage.eventMode = "static";

    app.ticker.add(this.tick, this);
    // Window-level cursor tracking — Pixi's stage events only fire when the
    // cursor is over the canvas, but the casting arrow needs to follow the
    // cursor even while it's over the StackDisplay portal or other UI.
    this.cursorListener = (e: MouseEvent) => {
      this.cursorViewportX = e.clientX;
      this.cursorViewportY = e.clientY;
    };
    window.addEventListener("mousemove", this.cursorListener);
    this.canvasLeaveListener = () => this.clearHandHover();
    this.app.canvas.addEventListener("pointerleave", this.canvasLeaveListener);
    prewarmManaSymbols();

    this.devOverridesUnsub = useGameDevStore.subscribe((state, prev) => {
      if (state.cardOverrides !== prev.cardOverrides && this.lastState) {
        this.updateBattlefield(this.lastState);
      }
      if (state.etbGlowVersion !== prev.etbGlowVersion) {
        for (const entry of this.entries.values()) {
          entry.etbGlowAlpha = 1;
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════

  /** True once `destroy()` has run. Effects that fire late must bail. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** DOM canvas element — used by the full-board arrows overlay to
   *  translate sprite coordinates across canvases. */
  get canvasElement(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }

  /**
   * Returns a sprite's current animated position (canvas-local) if it
   * exists in the battlefield or hand, else null. Falls back to the
   * animation *target* for the hand so arrows don't lag a lifting sprite.
   */
  getCardSpritePosition(cardId: string): ScreenPos | null {
    const entry = this.entries.get(cardId);
    if (entry) return { x: entry.targetX, y: entry.targetY };
    const handSprite = this.handSprites.get(cardId);
    if (!handSprite) return null;
    const target = this.handTargets.get(cardId);
    return target ? { x: target.x, y: target.y } : { x: handSprite.x, y: handSprite.y };
  }

  /** Canvas-local center of the next free battlefield slot (placement
   *  ghost position). Used by overlay arrows for permanent-spell casts. */
  getPlacementGhostCenter(): ScreenPos {
    const slot = this.findFirstFreeBattlefieldSlot();
    return {
      x: slot.x + (CARD_W * this.cardScale) / 2,
      y: slot.y + (CARD_H * this.cardScale) / 2,
    };
  }

  setTheme(theme: Theme): void {
    if (this.destroyed) return;
    this.theme = theme;
    this.arrowLayer.setTheme(theme);
    setCardSpriteTheme(theme);
    this.drawTableBackground();
  }

  setReserved(bottom: number, left?: number): void {
    if (this.destroyed) return;
    if (left !== undefined) this.leftReserved = left;
    this.dragHandler.setReserved(this.leftReserved, 0, bottom);
  }

  /**
   * Register additional canvas regions that must stay clear of auto-placed
   * and dragged cards — typically UI overlays like the PASS / phase-pass
   * button cluster at the bottom-right.
   */
  setExternalBlockers(rects: BlockingRect[]): void {
    if (this.destroyed) return;
    this.externalBlockers = rects;
    this.syncDragBlockers();
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  /**
   * Reserve a fixed-size rectangle anchored to the canvas bottom-right for
   * a UI overlay (e.g. the PASS / phase-pass buttons). Pass `null` to clear.
   */
  setBottomRightReserved(size: { width: number; height: number } | null): void {
    if (this.destroyed) return;
    this.bottomRightReserved = size;
    this.reportUsableHeight();
    this.syncDragBlockers();
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  /**
   * Reserve a fixed-size rectangle anchored to the canvas bottom-left for
   * the player panel cluster (avatar + zones + mana). Pass `null` to clear.
   */
  setBottomLeftReserved(size: { width: number; height: number } | null): void {
    if (this.destroyed) return;
    this.bottomLeftReserved = size;
    this.reportUsableHeight();
    this.syncDragBlockers();
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  setTopLeftReserved(size: { width: number; height: number } | null): void {
    if (this.destroyed) return;
    this.topLeftReserved = size;
    this.reportUsableHeight();
    this.syncDragBlockers();
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  /** The panel hogs the column — reserve the whole top row rather than the
   *  sliver beside it. */
  private topReserveIsFullWidth(): boolean {
    if (!this.topLeftReserved) return false;
    return this.topLeftReserved.width > this.app.renderer.width * OPPONENT_PANEL_FULLWIDTH_FRAC;
  }

  private topReserveInset(): number {
    return this.topReserveIsFullWidth() ? this.topLeftReserved!.height : 0;
  }

  private syncDragBlockers(): void {
    this.dragHandler.setExtraBlockers(this.collectOverlayBlockers());
  }

  /** External + bottom reserved rects resolved against current size.
   *  The bottom strip spans the full canvas width so no card can auto-
   *  place in the UI row (hand fan, player panel, PASS button). */
  private collectOverlayBlockers(): BlockingRect[] {
    const rects = [...this.externalBlockers];
    // Merge bottom-left and bottom-right into a single full-width strip
    // using the tallest reservation height.
    const blH = this.bottomLeftReserved?.height ?? 0;
    const brH = this.bottomRightReserved?.height ?? 0;
    const bottomH = Math.max(blH, brH);
    if (bottomH > 0) {
      const { width, height } = this.app.renderer;
      rects.push({ x: 0, y: height - bottomH, width, height: bottomH });
    }
    if (this.topLeftReserved && !this.topReserveIsFullWidth()) {
      rects.push({ x: 0, y: 0, ...this.topLeftReserved });
    }
    return rects;
  }

  setHandScale(scale: number): void {
    if (this.destroyed) return;
    this.vScale = scale;
    this.reportUsableHeight();
  }

  setCardScale(scale: number): void {
    if (this.destroyed || !Number.isFinite(scale) || scale <= 0) return;
    if (scale === this.cardScale) return;
    this.cardScale = scale;
    this.dragHandler.setCardScale(scale);
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  private reportUsableHeight(): void {
    const height = this.usableGridHeight();
    if (height === this.lastReportedHeight) return;
    this.lastReportedHeight = height;
    this.callbacks.onUsableHeightChange?.(height);
  }

  private usableGridHeight(): number {
    const zone = this.getPlayZone();
    const handBlockerTop = this.showHand
      ? this.handBottomY() - this.computeHandDimensions().cardH - GAP
      : zone.y + zone.height;
    const panelStrip = Math.max(
      this.bottomLeftReserved?.height ?? 0,
      this.bottomRightReserved?.height ?? 0,
    );
    const usableBottom = Math.min(handBlockerTop, zone.y + zone.height - panelStrip);
    return Math.max(CARD_H, usableBottom - zone.y);
  }

  resize(width: number, height: number): void {
    if (this.destroyed) return;
    this.app.renderer.resize(width, height);
    this.drawTableBackground();
    this.layoutEmptyText();
    // dragHandler clamps into the play-zone rect when one is set; otherwise
    // the full canvas.
    this.reportUsableHeight();
    const zone = this.getPlayZone();
    this.dragHandler.setContainerSize(zone.width, zone.height);
    // Bottom-right reserved rect is anchored to canvas size — re-resolve
    // so the keep-out follows the resize.
    this.syncDragBlockers();
    if (this.lastHandState) this.updateHand(this.lastHandState);
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  /**
   * Set the current arrow specs. They'll be resolved to canvas-local
   * coordinates every tick so arrows track any sprite that's animating
   * (drag, hand lift, layout re-flow). Pass `[]` to clear.
   */
  setArrowSpecs(specs: ArrowSpec[]): void {
    if (this.destroyed) return;
    this.arrowSpecs = specs;
  }

  /**
   * Set (or clear) the casting arrow that tracks the cursor during target
   * prompts. Pixi takes over the role of the React `CastingArrow` SVG
   * portal when this is enabled.
   */
  setCastingArrow(spec: CastingArrowSpec | null): void {
    if (this.destroyed) return;
    this.castingArrow = spec;
  }

  /**
   * Constrain battlefield + hand layout to a sub-rect of the canvas. When
   * unset, the full canvas is used. Pass the rect of the
   * "my half" zone when the canvas is promoted to cover the entire board.
   */
  setPlayZone(rect: PlayZoneRect | null): void {
    if (this.destroyed) return;
    this.playZone = rect;
    // Existing sprites may need to re-flow now that the reference rect has
    // moved — refresh battlefield + hand layouts immediately.
    this.drawTableBackground();
    if (this.lastState) this.updateBattlefield(this.lastState);
    if (this.lastHandState) this.updateHand(this.lastHandState);
    this.layoutEmptyText();
  }

  /** Current play-zone rectangle in canvas-local coords. Falls back to the
   *  full renderer size when no explicit zone was set. */
  private getPlayZone(): PlayZoneRect {
    if (this.playZone) return this.playZone;
    const { width, height } = this.app.renderer;
    const inset = this.topReserveInset();
    return { x: 0, y: inset, width, height: height - inset };
  }

  private layoutEmptyText(): void {
    const zone = this.getPlayZone();
    this.emptyText.scale.set(1);
    const maxWidth = zone.width - 16;
    if (maxWidth > 0 && this.emptyText.width > maxWidth) {
      this.emptyText.scale.set(maxWidth / this.emptyText.width);
    }
    this.emptyText.x = this.zoneCenterX();
    this.emptyText.y = this.zoneCenterY();
  }

  private zoneCenterX(): number {
    const z = this.getPlayZone();
    return z.x + z.width / 2;
  }

  private zoneCenterY(): number {
    const z = this.getPlayZone();
    return z.y + z.height / 2;
  }

  setDropActive(active: boolean): void {
    if (this.destroyed) return;
    // Capture the hovered cell when the drop ends (card released)
    if (!active && this.dropActive) {
      const zone = this.getPlayZone();
      const blockers = [...this.collectOverlayBlockers(), ...this.collectHandBlockers()];
      const grid = computeGridLayout(zone, this.leftReserved, blockers, this.cardScale);
      const canvasRect = this.app.canvas.getBoundingClientRect();
      const localX = this.cursorViewportX - canvasRect.left;
      const localY = this.cursorViewportY - canvasRect.top;
      const cell = cellFromPoint(grid, localX, localY);
      if (cell && !cell.blocked) {
        this.pendingDropSlot = { col: cell.col, row: cell.row };
      }
    }
    this.dropActive = active;
    this.drawDropTargetBackground(active);
    if (this.isInstantCastDrag()) this.recalcHandTargets();
  }

  showPlacementGhost(cardName: string | null): void {
    if (this.destroyed) return;
    this.drawPlacementGhost(cardName);
  }

  updateBattlefield(state: BattlefieldState): void {
    if (this.destroyed || !state || !Array.isArray(state.cards)) return;
    this.lastState = state;
    const cardMap = new Map<string, GameCard>(state.cards.map((c) => [c.id, c]));
    const currentIds = new Set(state.cards.map((c) => c.id));

    for (const childId of this.nameGroupChildren) {
      this.uiParent.delete(childId);
    }
    this.nameGroupChildren.clear();

    // Effective parent map: engine (`card.attachedTo`) wins, UI fallback only
    // if the engine didn't assert a parent for the child. Drops UI parents
    // whose child or parent already left the battlefield.
    const effectiveParent = new Map<string, string>();
    for (const c of state.cards) {
      if (c.attachedTo && cardMap.has(c.attachedTo)) {
        effectiveParent.set(c.id, c.attachedTo);
      }
    }
    for (const [childId, parentId] of [...this.uiParent]) {
      if (!currentIds.has(childId) || !currentIds.has(parentId)) {
        this.uiParent.delete(childId);
        continue;
      }
      if (childId === parentId) {
        this.uiParent.delete(childId);
        continue;
      }
      if (!effectiveParent.has(childId)) {
        effectiveParent.set(childId, parentId);
      }
    }
    const tentativeTopLevelForGrouping = state.cards.filter((c) => !effectiveParent.has(c.id));
    this.applyNameGrouping(tentativeTopLevelForGrouping);
    for (const [childId, parentId] of [...this.uiParent]) {
      if (!currentIds.has(childId) || !currentIds.has(parentId)) continue;
      if (childId === parentId) continue;
      if (!effectiveParent.has(childId)) {
        effectiveParent.set(childId, parentId);
      }
    }
    // Overflow pass: when there are more top-level cards than free grid
    // cells, UI-attach the extras to nearby keepers so they render as
    // manual-style stacks (parent underneath, stacked cards offset with the
    // attachment staircase) rather than piling on the same point.
    const tentativeTopLevel = state.cards.filter((c) => !effectiveParent.has(c.id));
    this.applyOverflowStacking(tentativeTopLevel);
    for (const [childId, parentId] of [...this.uiParent]) {
      if (!currentIds.has(childId) || !currentIds.has(parentId)) continue;
      if (childId === parentId) continue;
      if (!effectiveParent.has(childId)) {
        effectiveParent.set(childId, parentId);
      }
    }

    const effectiveChildren = new Map<string, string[]>();
    for (const [childId, parentId] of effectiveParent) {
      const list = effectiveChildren.get(parentId) ?? [];
      list.push(childId);
      effectiveChildren.set(parentId, list);
    }
    const topLevelCards = state.cards.filter((c) => !effectiveParent.has(c.id));

    this.pruneRemovedBattlefieldEntries(currentIds);
    // Drop user slots for cards that left the battlefield or became attached.
    for (const id of [...this.userSlots.keys()]) {
      if (!currentIds.has(id) || effectiveParent.has(id)) {
        this.userSlots.delete(id);
      }
    }
    const positions = this.computeBattlefieldGrid(topLevelCards);
    this.gridTargets = positions;

    for (const card of topLevelCards) {
      const center = positions.get(card.id) ?? {
        x: this.zoneCenterX(),
        y: this.zoneCenterY(),
      };
      const childIds = effectiveChildren.get(card.id) ?? [];
      const attachments = childIds
        .map((id) => cardMap.get(id))
        .filter((c): c is GameCard => c !== undefined);
      const totalOffset = attachments.length * ATTACH_OFFSET_Y;
      const topLeftY = center.y - (CARD_H * this.cardScale) / 2;

      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i]!;
        this.placeBattlefieldCard(
          att,
          center.x,
          topLeftY +
            totalOffset -
            (attachments.length - i) * ATTACH_OFFSET_Y +
            (CARD_H * this.cardScale) / 2,
          i + 1,
          state,
        );
      }

      this.placeBattlefieldCard(
        card,
        center.x,
        topLeftY + totalOffset + (CARD_H * this.cardScale) / 2,
        attachments.length + 1,
        state,
      );
    }

    this.emptyText.visible = state.cards.length === 0;
  }

  updateHand(state: HandState): void {
    if (this.destroyed || !state || !Array.isArray(state.cards)) return;
    // Opponent canvases never show a hand fan — just silently absorb the
    // state update so callers don't need to guard against the mode.
    if (!this.showHand) {
      this.handHitZones = [];
      return;
    }
    this.lastHandState = state;
    if (this.hoveredHandIndex !== null && this.hoveredHandIndex >= state.cards.length) {
      this.hoveredHandIndex = null;
    }
    this.pruneRemovedHandSprites(new Set(state.cards.map((c) => c.id)));
    this.dragHandler.setHandExclusion(this.collectHandBlockers()[0] ?? null);

    const dims = this.computeHandDimensions();
    const baseLayout = computeBaseLayout(
      state.cards.length,
      dims.cardW,
      dims.maxSpread,
      dims.minSpread,
      dims.spreadWidth,
    );
    const layout = computeHandLayout(
      state.cards.length,
      dims.cardW,
      dims.cardH,
      dims.maxSpread,
      dims.minSpread,
      dims.spreadWidth,
      this.hoveredHandIndex,
      dims.hoverLift,
      dims.neighborPush,
    );

    const zone = this.getPlayZone();
    const centerX = zone.x + zone.width / 2;
    const bottomY = this.handBottomY();
    const hitZones: HandHitZone[] = [];

    for (let i = 0; i < state.cards.length; i++) {
      const card = state.cards[i]!;
      const l = layout[i]!;
      const base = baseLayout[i]!;
      const isHovered = this.hoveredHandIndex === i;
      const selectionMode = state.selectionMode === true;
      const isSelected = selectionMode && (state.selectedIds?.has(card.id) ?? false);
      const isCastDrag = !selectionMode && card.id === state.draggingCardId;
      const isCastingPermanent = isCastDrag && state.draggingIsPermanent === true;
      const isCastingSpell = isCastDrag && state.draggingIsPermanent !== true;
      const selectedDrop = isSelected ? Math.round(HAND_SELECTION_DROP_PX * this.vScale) : 0;
      const reshapeFan =
        !selectionMode &&
        state.draggingCardId != null &&
        (state.draggingIsPermanent === true || this.dropActive);
      const castOffset = reshapeFan
        ? Math.round(
            (isCastingPermanent ? CAST_DRAG_CARD_DROP_PX : CAST_DRAG_HAND_SINK_PX) * this.vScale,
          )
        : 0;
      const castScale = isCastingPermanent ? CAST_DRAG_SCALE : 1;

      let sprite = this.handSprites.get(card.id);
      if (!sprite) {
        sprite = this.createHandSprite(card);
        sprite.x = centerX + l.x;
        sprite.y = bottomY + l.y - l.scaleH / 2;
        sprite.scale.set(l.scaleW / CARD_W, l.scaleH / CARD_H);
      } else {
        // updateCardContent, not updateCard: the hand's animation tick owns
        // rotation (arc-fan angle) and alpha (dragging/casting); touching
        // them here would snap-jump back to defaults and re-lerp every tick.
        sprite.updateCardContent(card);
      }

      const isHidden = !selectionMode && (card.id === state.castingCardId || isCastingSpell);
      sprite.alpha = isHidden ? 0 : 1;
      sprite.cursor = selectionMode ? "pointer" : card.isPlayable ? "grab" : "default";

      this.handTargets.set(card.id, {
        x: centerX + l.x,
        y: bottomY + l.y - l.scaleH / 2 + selectedDrop + castOffset,
        rot: isSelected || isCastingPermanent ? 0 : (l.rotation * Math.PI) / 180,
        scaleX: (l.scaleW / CARD_W) * castScale,
        scaleY: (l.scaleH / CARD_H) * castScale,
        zIndex: isHovered || isCastingPermanent ? Z_HAND_HOVERED : i + 1,
      });
      hitZones.push({
        index: i,
        card,
        x: centerX + base.x,
        y: bottomY + base.drop - dims.cardH / 2 + selectedDrop,
        width: dims.cardW,
        height: dims.cardH,
      });

      this.applyHandCardHighlight(
        sprite,
        card,
        isHovered,
        selectionMode,
        isSelected,
        isCastingPermanent,
      );
    }
    this.handHitZones = hitZones;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelHandHoverHoldTimer();
    this.cancelBattlefieldHoverClear();
    if (this.cursorListener) {
      window.removeEventListener("mousemove", this.cursorListener);
      this.cursorListener = null;
    }
    if (this.canvasLeaveListener) {
      this.app.canvas.removeEventListener("pointerleave", this.canvasLeaveListener);
      this.canvasLeaveListener = null;
    }
    if (this.devOverridesUnsub) {
      this.devOverridesUnsub();
      this.devOverridesUnsub = null;
    }
    // Unregister everything *non-display-tree*: stop animation + pointer
    // event routing BEFORE the display is torn down so no late tick or
    // pointermove can target half-destroyed Graphics / Text objects.
    this.app.ticker.remove(this.tick, this);
    this.app.stage.off("pointermove");
    this.app.stage.off("pointerup");
    this.app.stage.off("pointerupoutside");
    try {
      this.marquee.destroy();
      this.dragHandler.destroy();
      this.arrowLayer.destroy();
    } catch (err) {
      console.warn("[pixi] handler teardown threw:", err);
    }
    this.handSprites.clear();
    this.handHitZones = [];
    this.entries.clear();
    // Leave the Pixi display tree to `app.destroy(true)` (called right
    // after scene.destroy in PixiGameCanvas). Our previous attempt to
    // `root.destroy({ children: true })` cascaded into a Pixi v8
    // TexturePool.returnTexture crash on the selection-badge / empty-text
    // objects — pool state gets confused for Text assets shared across the
    // renderer. Letting the app destroy the stage in one pass avoids it.
  }

  // ═══════════════════════════════════════════════════════════════
  // Background + drop target
  // ═══════════════════════════════════════════════════════════════

  private drawTableBackground(): void {
    // Background fills only the play zone so the rest of the canvas stays
    // transparent for arrows + overlays spanning the full viewport.
    const zone = this.getPlayZone();
    this.backgroundGfx.clear();
    this.backgroundGfx.roundRect(zone.x, zone.y, zone.width, zone.height, TABLE_RADIUS);
    this.backgroundGfx.fill({
      color: hexToNum(this.theme.gameTheme.canvas.background),
      alpha: BG_ALPHA_IDLE,
    });
  }

  private drawDropTargetBackground(active: boolean): void {
    const zone = this.getPlayZone();
    this.backgroundGfx.clear();
    this.backgroundGfx.roundRect(zone.x, zone.y, zone.width, zone.height, TABLE_RADIUS);
    this.backgroundGfx.fill({
      color: hexToNum(this.theme.gameTheme.canvas.background),
      alpha: BG_ALPHA_DROP,
    });
    if (!active) {
      // Hide the grid skeleton when not dropping
      this.gridSkeletonGfx.visible = false;
      return;
    }
    this.drawDropVisual();
  }

  private drawDropVisual(): void {
    if (this.isInstantCastDrag()) this.drawDropFieldHighlight();
    else this.drawDropGrid();
  }

  private isInstantCastDrag(): boolean {
    return (
      this.lastHandState?.draggingCardId != null && this.lastHandState?.draggingIsPermanent !== true
    );
  }

  private drawDropFieldHighlight(): void {
    const zone = this.getPlayZone();
    const color = hexToNum(this.theme.gameTheme.arrow.friendlyTarget);
    const pad = GAP * 2;
    const gfx = this.gridSkeletonGfx;
    gfx.clear();
    gfx.roundRect(
      zone.x + pad,
      zone.y + pad,
      zone.width - pad * 2,
      zone.height - pad * 2,
      TABLE_RADIUS,
    );
    gfx.fill({ color, alpha: GRID_SKELETON_FILL_ALPHA * 4 });
    gfx.stroke({ color, width: 3, alpha: GRID_SKELETON_HOVER_ALPHA });
    gfx.visible = true;
  }

  /** Draw the grid skeleton for hand-to-battlefield drops, highlighting the cell under the cursor. */
  private drawDropGrid(): void {
    const zone = this.getPlayZone();
    const blockers = [...this.collectOverlayBlockers(), ...this.collectHandBlockers()];
    const grid = computeGridLayout(zone, this.leftReserved, blockers, this.cardScale);
    const color = hexToNum(this.theme.gameTheme.activeAction.active);
    const gfx = this.gridSkeletonGfx;
    gfx.clear();

    // Find which cell the cursor is over (convert viewport coords to canvas-local)
    const canvasRect = this.app.canvas.getBoundingClientRect();
    const localX = this.cursorViewportX - canvasRect.left;
    const localY = this.cursorViewportY - canvasRect.top;
    const hoveredCell = cellFromPoint(grid, localX, localY);
    const hoveredKey =
      hoveredCell && !hoveredCell.blocked ? cellKey(hoveredCell.col, hoveredCell.row) : null;

    for (const cell of grid.cells) {
      if (cell.blocked) continue;
      const key = cellKey(cell.col, cell.row);
      const isHover = key === hoveredKey;
      gfx.roundRect(cell.x, cell.y, grid.cardW, grid.cardH, CARD_RADIUS);
      gfx.fill({ color, alpha: isHover ? GRID_SKELETON_FILL_ALPHA * 5 : GRID_SKELETON_FILL_ALPHA });
      gfx.stroke({
        color,
        width: isHover ? 2 : 1,
        alpha: isHover ? GRID_SKELETON_HOVER_ALPHA : GRID_SKELETON_STROKE_ALPHA,
      });
    }
    gfx.visible = true;
  }

  // ═══════════════════════════════════════════════════════════════
  // Placement ghost
  // ═══════════════════════════════════════════════════════════════

  /**
   * Draw the grid skeleton that appears under the dragging sprite. Each
   * unblocked cell gets a faint outline; the cell under the cursor brightens
   * up; if the cursor is over another card's cell (stack target) it uses a
   * filled accent so the user can see the attach will happen.
   */
  private drawGridSkeleton(draggingIds: Set<string>): void {
    const gfx = this.gridSkeletonGfx;
    gfx.clear();
    if (!this.gridInfo || draggingIds.size === 0) {
      gfx.visible = false;
      return;
    }
    const grid = this.gridInfo;
    const color = hexToNum(this.theme.gameTheme.activeAction.active);
    const occupied = new Map<string, string>();
    for (const [id, pos] of this.gridTargets) {
      if (draggingIds.has(id)) continue;
      const c = cellFromPoint(grid, pos.x, pos.y);
      if (c) occupied.set(cellKey(c.col, c.row), id);
    }
    const hoveredKey = this.hoveredCell
      ? cellKey(this.hoveredCell.col, this.hoveredCell.row)
      : null;
    const stackKey =
      this.stackTargetId !== null
        ? (() => {
            const pos = this.gridTargets.get(this.stackTargetId!);
            if (!pos) return null;
            const c = cellFromPoint(grid, pos.x, pos.y);
            return c ? cellKey(c.col, c.row) : null;
          })()
        : null;

    for (const cell of grid.cells) {
      if (cell.blocked) continue;
      const key = cellKey(cell.col, cell.row);
      const isStack = key === stackKey;
      const isHover = key === hoveredKey && !isStack;
      const isOccupied = occupied.has(key) && !isStack;
      const strokeAlpha = isStack
        ? GRID_SKELETON_STACK_ALPHA
        : isHover
          ? GRID_SKELETON_HOVER_ALPHA
          : GRID_SKELETON_STROKE_ALPHA;
      const fillAlpha = isStack
        ? GRID_SKELETON_STACK_FILL_ALPHA
        : isHover
          ? GRID_SKELETON_FILL_ALPHA * 4
          : isOccupied
            ? 0
            : GRID_SKELETON_FILL_ALPHA;
      gfx.roundRect(cell.x, cell.y, grid.cardW, grid.cardH, CARD_RADIUS);
      if (fillAlpha > 0) gfx.fill({ color, alpha: fillAlpha });
      gfx.stroke({ color, width: isStack || isHover ? 2 : 1, alpha: strokeAlpha });
    }
    gfx.visible = true;
  }

  private drawPlacementGhost(cardName: string | null): void {
    const { gfx, text } = this.ensurePlacementGhostLayers();
    if (!cardName) {
      gfx.visible = false;
      text.visible = false;
      return;
    }

    const slot = this.findFirstFreeBattlefieldSlot();
    const w = CARD_W * this.cardScale;
    const h = CARD_H * this.cardScale;
    const cx = slot.x + w / 2;
    const cy = slot.y + h / 2;
    const color = hexToNum(this.theme.gameTheme.activeAction.active);

    gfx.clear();
    gfx.roundRect(cx - w / 2, cy - h / 2, w, h, CARD_RADIUS);
    gfx.stroke({ color, width: 2, alpha: GHOST_STROKE_ALPHA });
    gfx.fill({ color, alpha: GHOST_FILL_ALPHA });
    gfx.visible = true;

    text.text = cardName;
    text.x = cx;
    text.y = cy;
    text.visible = true;
  }

  private ensurePlacementGhostLayers(): { gfx: Graphics; text: Text } {
    if (this.placementGhostGfx && this.placementGhostText) {
      return { gfx: this.placementGhostGfx, text: this.placementGhostText };
    }
    const gfx = new Graphics();
    gfx.zIndex = Z_PLACEMENT_GHOST;
    this.myBattlefieldContainer.addChild(gfx);

    const text = new Text({ text: "", style: GHOST_LABEL_STYLE });
    text.anchor.set(0.5);
    text.zIndex = Z_PLACEMENT_GHOST_TEXT;
    this.myBattlefieldContainer.addChild(text);

    this.placementGhostGfx = gfx;
    this.placementGhostText = text;
    return { gfx, text };
  }

  // ═══════════════════════════════════════════════════════════════
  // Battlefield layout
  // ═══════════════════════════════════════════════════════════════

  private applyNameGrouping(topLevel: GameCard[]): void {
    this.stackCounts.clear();
    if (topLevel.length < 2) return;

    const isStackable = (c: GameCard): boolean =>
      !c.isAttacking &&
      !c.attachedTo &&
      !c.isBestowed &&
      !c.isFaceDown &&
      !c.isTransformed &&
      (!c.attachmentIds || c.attachmentIds.length === 0) &&
      !this.userPlacedCards.has(c.id);

    const byNameAndTap = new Map<string, GameCard[]>();
    for (const c of topLevel) {
      if (!isStackable(c)) continue;
      const key = `${c.tapped ? "t" : "u"}:${c.name}`;
      const list = byNameAndTap.get(key);
      if (list) list.push(c);
      else byNameAndTap.set(key, [c]);
    }

    for (const group of byNameAndTap.values()) {
      if (group.length < 2) continue;
      const parent = group[0]!;
      for (let i = 1; i < group.length; i++) {
        const child = group[i]!;
        this.uiParent.set(child.id, parent.id);
        this.nameGroupChildren.add(child.id);
      }
      this.stackCounts.set(parent.id, group.length);
    }
  }

  /**
   * When there are more top-level cards than free grid cells, pick the
   * lowest-priority cards (no user slot first, then latest in state order)
   * and mark them as `uiParent` children of nearby keepers. Makes overflow
   * render identically to manually-stacked cards instead of piling up at
   * a single anchor point.
   */
  private applyOverflowStacking(topLevelCandidates: GameCard[]): void {
    if (topLevelCandidates.length === 0) return;
    const zone = this.getPlayZone();
    const blockers = [...this.collectOverlayBlockers(), ...this.collectHandBlockers()];
    const grid = computeGridLayout(zone, this.leftReserved, blockers, this.cardScale);
    let freeCellCount = 0;
    for (const cell of grid.cells) {
      if (!cell.blocked) freeCellCount++;
    }
    if (topLevelCandidates.length <= freeCellCount) return;

    // Reparent the lowest-priority cards: no user slot first, then latest
    // by state order. Stable sort keeps state order within each bucket.
    const prioritized = topLevelCandidates.map((card, i) => ({ card, i }));
    prioritized.sort((a, b) => {
      const aHas = this.userSlots.has(a.card.id) ? 1 : 0;
      const bHas = this.userSlots.has(b.card.id) ? 1 : 0;
      if (aHas !== bHas) return aHas - bHas;
      return a.i - b.i;
    });
    const overflowCount = topLevelCandidates.length - freeCellCount;
    const overflow = prioritized.slice(-overflowCount).map((p) => p.card);
    const overflowIds = new Set(overflow.map((c) => c.id));
    const keepers = topLevelCandidates.filter((c) => !overflowIds.has(c.id));
    if (keepers.length === 0) return;

    const centerX = zone.x + zone.width / 2;
    const topAnchorY = zone.y + grid.cellH / 2;
    const bottomAnchorY = zone.y + zone.height - grid.cellH / 2;
    const nonLandAnchorY = this.mirrored ? bottomAnchorY : topAnchorY;
    const landAnchorY = this.mirrored ? topAnchorY : bottomAnchorY;

    const keeperPos = (id: string, fallbackY: number): Point => {
      const slot = this.userSlots.get(id);
      if (slot) {
        const cell = cellAt(grid, slot.col, slot.row);
        if (cell) return { x: cell.cx, y: cell.cy };
      }
      return { x: centerX, y: fallbackY };
    };

    for (const oc of overflow) {
      const isLand = oc.types.includes("Land");
      const anchorY = isLand ? landAnchorY : nonLandAnchorY;
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const k of keepers) {
        if (k.id === oc.id) continue;
        const kp = keeperPos(k.id, anchorY);
        const d = (kp.x - centerX) ** 2 + (kp.y - anchorY) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestId = k.id;
        }
      }
      if (bestId) {
        this.uiParent.set(oc.id, bestId);
        this.userSlots.delete(oc.id);
      }
    }
  }

  /**
   * Build the battlefield grid layout and assign each top-level card a
   * cell center. Honors user-dragged slots first, then auto-places any
   * remaining cards by picking the nearest free cell to a preferred anchor
   * (center for non-lands, bottom-center for lands).
   */
  private computeBattlefieldGrid(cards: GameCard[]): Map<string, Point> {
    const positions = new Map<string, Point>();
    const zone = this.getPlayZone();
    const handBlocker = this.collectHandBlockers();
    const blockers = [...this.collectOverlayBlockers(), ...handBlocker];
    const grid = computeGridLayout(zone, this.leftReserved, blockers, this.cardScale);
    this.gridInfo = grid;

    const occupied = new Set<string>();
    const unplaced: GameCard[] = [];

    // Pass 1: honor user-dragged slots. A slot pointing at a temporarily
    // blocked cell (e.g. the stack panel just appeared) is kept in the map
    // so the card can snap back when the blocker clears — the card is
    // pushed through pass 2 and auto-placed at the nearest free cell for
    // now. Only drop the slot if the cell has gone out of grid bounds
    // (the grid itself was resized smaller).
    for (const c of cards) {
      const slot = this.userSlots.get(c.id);
      if (!slot) {
        unplaced.push(c);
        continue;
      }
      const cell = cellAt(grid, slot.col, slot.row);
      if (!cell) {
        this.userSlots.delete(c.id);
        unplaced.push(c);
        continue;
      }
      if (cell.blocked || occupied.has(cellKey(cell.col, cell.row))) {
        unplaced.push(c);
        continue;
      }
      positions.set(c.id, { x: cell.cx, y: cell.cy });
      occupied.add(cellKey(cell.col, cell.row));
    }

    // Assign pending drop slot to the first new card (from a hand drop)
    if (this.pendingDropSlot && unplaced.length > 0) {
      const dropCell = cellAt(grid, this.pendingDropSlot.col, this.pendingDropSlot.row);
      if (dropCell && !dropCell.blocked && !occupied.has(cellKey(dropCell.col, dropCell.row))) {
        // Find the first unplaced card that doesn't already have a user slot
        const dropCandidate = unplaced[0]!;
        this.userSlots.set(dropCandidate.id, this.pendingDropSlot);
        this.userPlacedCards.add(dropCandidate.id);
        positions.set(dropCandidate.id, { x: dropCell.cx, y: dropCell.cy });
        occupied.add(cellKey(dropCell.col, dropCell.row));
        unplaced.shift();
      }
      this.pendingDropSlot = null;
    }

    // Pass 2: auto-place remaining cards following MTG tournament layout,
    // grouped by permanent category:
    //
    //   Row 0  (closest to opponent): Creatures
    //   Row 1  (middle):              Other non-lands (artifacts, enchantments, planeswalkers, …)
    //   Row 2+ (closest to player):   Lands
    //
    // For mirrored (opponent) view the order flips — row 0 is their land
    // zone (closest to them).  Each category first tries its preferred
    // row(s), then overflows into any free cell.

    const centerX = zone.x + zone.width / 2;

    // Find the last unblocked row — the bottom exclusion strip may block
    // the geometrically last row(s).
    let lastUsableRow = grid.rows - 1;
    while (lastUsableRow > 0) {
      const midCell = cellAt(grid, Math.floor(grid.cols / 2), lastUsableRow);
      if (midCell && !midCell.blocked) break;
      lastUsableRow--;
    }

    // Distribute usable rows across three zones. With ≥3 usable rows:
    //   creatures = row 0, other = row 1, lands = row 2+
    // With 2 usable rows: creatures = row 0, lands+other = row 1
    // With 1 usable row: everything shares row 0
    const usableRows = lastUsableRow + 1;
    let creatureRows: number[];
    let otherRows: number[];
    let landRows: number[];
    if (usableRows >= 3) {
      creatureRows = [0];
      otherRows = [];
      for (let r = 1; r < lastUsableRow; r++) otherRows.push(r);
      if (otherRows.length === 0) otherRows.push(1);
      landRows = [lastUsableRow];
    } else if (usableRows === 2) {
      creatureRows = [0];
      otherRows = [0, 1];
      landRows = [lastUsableRow];
    } else {
      creatureRows = [0];
      otherRows = [0];
      landRows = [0];
    }

    // For mirrored (opponent) view, flip the row assignments so their
    // creatures are at the bottom (furthest from us) and lands at the top.
    if (this.mirrored) {
      const flip = (rows: number[]) => rows.map((r) => lastUsableRow - r);
      creatureRows = flip(creatureRows);
      otherRows = flip(otherRows);
      landRows = flip(landRows);
    }

    // Classify each permanent into a category.
    type CardCategory = "creature" | "land" | "other";
    const classify = (c: GameCard): CardCategory => {
      if (c.types.includes("Creature")) return "creature";
      if (c.types.includes("Land")) return "land";
      return "other";
    };

    const categoryConfig: Record<CardCategory, { rows: number[]; anchorTop: boolean }> = {
      creature: { rows: creatureRows, anchorTop: !this.mirrored },
      other: { rows: otherRows, anchorTop: !this.mirrored },
      land: { rows: landRows, anchorTop: this.mirrored },
    };

    // Sort unplaced cards so creatures are placed first (they get priority
    // on row 0), then other non-lands, then lands.
    const catOrder: CardCategory[] = ["creature", "other", "land"];
    const sortedUnplaced = [...unplaced].sort(
      (a, b) => catOrder.indexOf(classify(a)) - catOrder.indexOf(classify(b)),
    );

    for (const c of sortedUnplaced) {
      const cat = classify(c);
      const cfg = categoryConfig[cat];
      const rowSet = new Set(cfg.rows);
      const anchorY = cfg.anchorTop
        ? zone.y + grid.cellH / 2
        : zone.y + zone.height - grid.cellH / 2;
      const sorted = cellsByDistance(grid, centerX, anchorY);
      const max = cat === "land" ? MAX_LAND_SLOTS : MAX_GRID_SLOTS;

      // First pass: restrict to preferred rows.
      let picked: GridCell | null = null;
      for (let i = 0; i < sorted.length && i < max; i++) {
        const cell = sorted[i]!;
        if (cell.blocked) continue;
        if (occupied.has(cellKey(cell.col, cell.row))) continue;
        if (!rowSet.has(cell.row)) continue;
        picked = cell;
        break;
      }

      // Overflow: if preferred rows are full, use any free cell.
      if (!picked) {
        for (let i = 0; i < sorted.length && i < max; i++) {
          const cell = sorted[i]!;
          if (cell.blocked) continue;
          if (occupied.has(cellKey(cell.col, cell.row))) continue;
          picked = cell;
          break;
        }
      }

      if (picked) {
        positions.set(c.id, { x: picked.cx, y: picked.cy });
        occupied.add(cellKey(picked.col, picked.row));
        this.userSlots.set(c.id, { col: picked.col, row: picked.row });
      } else {
        positions.set(c.id, { x: centerX, y: anchorY });
      }
    }

    return positions;
  }

  /**
   * Canvas-local top-left of the cell where a newly-played permanent would
   * land. Used by the placement-ghost overlay — prefers the grid center.
   */
  private findFirstFreeBattlefieldSlot(): Point {
    const zone = this.getPlayZone();
    const grid =
      this.gridInfo ??
      computeGridLayout(
        zone,
        this.leftReserved,
        [...this.collectOverlayBlockers(), ...this.collectHandBlockers()],
        this.cardScale,
      );
    const occupied = new Set<string>();
    for (const id of this.gridTargets.keys()) {
      const pos = this.gridTargets.get(id);
      if (!pos) continue;
      const cell = cellFromPoint(grid, pos.x, pos.y);
      if (cell) occupied.add(cellKey(cell.col, cell.row));
    }

    // If the user dropped a card onto a specific slot, use that slot
    // for the placement ghost / arrow target — single source of truth.
    if (this.pendingDropSlot) {
      const dropCell = cellAt(grid, this.pendingDropSlot.col, this.pendingDropSlot.row);
      if (dropCell && !dropCell.blocked && !occupied.has(cellKey(dropCell.col, dropCell.row))) {
        return { x: dropCell.x, y: dropCell.y };
      }
    }

    const anchorX = zone.x + zone.width / 2;
    // Placement ghost targets the creature zone (row 0 for local player)
    // since most spells being cast are creatures.
    const anchorY = this.mirrored ? zone.y + zone.height - grid.cellH / 2 : zone.y + grid.cellH / 2;
    const sorted = cellsByDistance(grid, anchorX, anchorY);
    for (const cell of sorted) {
      if (cell.blocked) continue;
      if (occupied.has(cellKey(cell.col, cell.row))) continue;
      return { x: cell.x, y: cell.y };
    }
    return { x: anchorX - grid.cardW / 2, y: anchorY - grid.cardH / 2 };
  }

  /**
   * Approximate bounding rectangle of the hand fan in canvas coordinates.
   * The auto-placement grid treats this as a blocker so lands can fill the
   * (often generous) space to the left and right of the hand.
   */
  private collectHandBlockers(): BlockingRect[] {
    const count = this.lastHandState?.cards.length ?? 0;
    if (count === 0) return [];

    const dims = this.computeHandDimensions();
    const spread =
      count <= 1
        ? 0
        : Math.max(
            dims.minSpread,
            Math.min(dims.maxSpread, Math.floor((dims.spreadWidth - dims.cardW) / (count - 1))),
          );
    const totalSpread = count <= 1 ? 0 : (count - 1) * spread;
    const handW = totalSpread + dims.cardW;
    const handH = dims.cardH;
    const zone = this.getPlayZone();

    // Blocker covers from where the hand actually starts (using the
    // canonical bottomY) down to the zone bottom.
    const bottomY = this.handBottomY();
    const handTopY = bottomY - handH;
    const zoneBottom = zone.y + zone.height;
    // Only block the portion that's inside the visible zone
    const blockerTop = Math.max(zone.y, handTopY) - GAP;
    const blockerH = zoneBottom - blockerTop;
    if (blockerH <= 0) return [];
    return [
      {
        x: zone.x + zone.width / 2 - handW / 2 - GAP,
        y: blockerTop,
        width: handW + GAP * 2,
        height: blockerH,
      },
    ];
  }

  // ═══════════════════════════════════════════════════════════════
  // Battlefield entries
  // ═══════════════════════════════════════════════════════════════

  private pruneRemovedBattlefieldEntries(currentIds: Set<string>): void {
    for (const [id, entry] of this.entries) {
      if (currentIds.has(id)) continue;
      this.myBattlefieldContainer.removeChild(entry.sprite);
      if (entry.overlay) this.myBattlefieldContainer.removeChild(entry.overlay);
      safeDestroy(entry.sprite);
      if (entry.overlay) safeDestroy(entry.overlay);
      this.entries.delete(id);
      this.userPlacedCards.delete(id);
    }
  }

  private placeBattlefieldCard(
    card: GameCard,
    centerX: number,
    centerY: number,
    zIndex: number,
    state: BattlefieldState,
  ): void {
    this.ensureBattlefieldEntry(card);
    const entry = this.entries.get(card.id)!;
    entry.targetX = centerX;
    entry.targetY = centerY;
    entry.targetZIndex = zIndex;
    const overriddenCard =
      card.id === DEBUG_KEYWORD_CARD_ID
        ? applyCardOverrides(card, useGameDevStore.getState().cardOverrides)
        : card;
    entry.sprite.updateCard(overriddenCard);
    entry.sprite.setStackCount(this.stackCounts.get(card.id) ?? 1);
    entry.targetRotation = overriddenCard.tapped ? (this.mirrored ? -Math.PI / 2 : Math.PI / 2) : 0;
    this.applyBattlefieldRing(entry.sprite, state);
    this.rebuildBattlefieldOverlay(entry, state);
  }

  private ensureBattlefieldEntry(card: GameCard): void {
    if (this.entries.has(card.id)) return;
    const isEntering = this.entries.size > 0;
    const sprite = new CardSprite(card);
    this.wireBattlefieldCardEvents(sprite);
    this.myBattlefieldContainer.addChild(sprite);

    // Seed the new battlefield sprite's position + scale so its entering
    // animation starts from where the player last saw the card:
    // 1. Live hand sprite (land / instant-speed play) → its own position.
    // 2. Recent stack position (spell just resolved from the stack) → the
    //    last-known stack card rect, captured each tick from the DOM.
    // 3. Otherwise → hand fan center at the bottom of the play zone.
    // Without (2) the card appears to leap out of the hand even when it
    // visibly just resolved off the top of the stack.
    const handSprite = this.handSprites.get(card.id);
    const stackSeed = this.stackCardSeeds.get(card.id);
    if (handSprite) {
      sprite.x = handSprite.x;
      sprite.y = handSprite.y;
      sprite.scale.set(handSprite.scale.x, handSprite.scale.y);
    } else if (stackSeed) {
      sprite.x = stackSeed.x;
      sprite.y = stackSeed.y;
      sprite.scale.set(stackSeed.scale);
    } else {
      const seed = this.computeHandOriginSeed();
      sprite.x = seed.x;
      sprite.y = seed.y;
      sprite.scale.set(seed.scale);
    }

    this.entries.set(card.id, {
      sprite,
      // Start target identical to initial position; `placeBattlefieldCard`
      // overwrites immediately with the real grid slot so the tick knows
      // where to ease toward.
      targetX: sprite.x,
      targetY: sprite.y,
      targetZIndex: 1,
      targetRotation: sprite.rotation,
      etbGlowAlpha: isEntering ? 1 : 0,
      overlay: null,
    });
  }

  private wireBattlefieldCardEvents(sprite: CardSprite): void {
    sprite.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.onBattlefieldCardDown(sprite, e);
    });

    sprite.on("pointertap", () => {
      if (this.dragHandler.justDraggedCardIds.has(sprite.card.id)) return;
      this.onBattlefieldCardTap(sprite.card);
    });

    sprite.on("pointerenter", () => this.setBattlefieldCardHovered(sprite));
    sprite.on("pointerleave", () => this.scheduleBattlefieldHoverClear(sprite.card.id));
  }

  setCastDragActive(active: boolean): void {
    if (this.destroyed || active === this.castDragActive) return;
    this.castDragActive = active;
    if (active) this.clearBattlefieldHover();
  }

  private clearBattlefieldHover(): void {
    this.cancelBattlefieldHoverClear();
    if (this.hoveredCardId === null) return;
    this.hoveredCardId = null;
    this.callbacks.onHoverCard?.(null);
  }

  private setBattlefieldCardHovered(sprite: CardSprite): void {
    if (this.castDragActive) return;
    this.cancelBattlefieldHoverClear();
    const wasHovered = this.hoveredCardId === sprite.card.id;
    this.hoveredCardId = sprite.card.id;
    if (wasHovered) return;
    const bounds = sprite.getBounds();
    const canvasRect = this.app.canvas.getBoundingClientRect();
    this.callbacks.onHoverCard?.(
      sprite.card,
      {
        x: bounds.x + canvasRect.left,
        y: bounds.y + canvasRect.top,
        width: bounds.width,
        height: bounds.height,
      },
      { useAnchor: true },
    );
  }

  private scheduleBattlefieldHoverClear(cardId: string): void {
    if (this.hoveredCardId !== cardId) return;
    this.cancelBattlefieldHoverClear();
    this.battlefieldHoverClearTimer = window.setTimeout(() => {
      this.battlefieldHoverClearTimer = null;
      if (this.destroyed) return;
      if (this.hoveredCardId !== cardId) return;
      this.hoveredCardId = null;
      this.callbacks.onHoverCard?.(null);
    }, BATTLEFIELD_HOVER_HOLD_MS);
  }

  private cancelBattlefieldHoverClear(): void {
    if (this.battlefieldHoverClearTimer !== null) {
      window.clearTimeout(this.battlefieldHoverClearTimer);
      this.battlefieldHoverClearTimer = null;
    }
  }

  private onBattlefieldCardTap(card: GameCard): void {
    if (this.destroyed) return;
    const state = this.lastState;
    if (!state) {
      this.callbacks.onClickCard?.(card);
      return;
    }

    const kind: ActionKind = {
      isTappable: state.tappableLandIds?.includes(card.id) ?? false,
      isUntappable: state.untappableLandIds?.includes(card.id) ?? false,
      isSelectable: state.selectableCardIds?.includes(card.id) ?? false,
    };

    if (kind.isTappable) {
      const expandedMana = state.manaAbilityOptions
        ? getExpandedManaAbilities(card.id, state.manaAbilityOptions)
        : [];
      if (expandedMana.length > 1) {
        this.callbacks.onClickCard?.(card);
        return;
      }
      this.dispatchBattlefieldAction(card, state, kind);
      return;
    }

    if (kind.isUntappable) {
      this.dispatchBattlefieldAction(card, state, kind);
      return;
    }

    this.callbacks.onClickCard?.(card);
  }

  // ═══════════════════════════════════════════════════════════════
  // Battlefield rings + overlays
  // ═══════════════════════════════════════════════════════════════

  private applyBattlefieldRing(sprite: CardSprite, state: BattlefieldState): void {
    // Selected cards always wear the selection ring. Without this guard
    // any subsequent updateBattlefield (triggered by hover → React
    // re-render → prop change) overwrites the marquee selection glow
    // even though `selectedCardIds` is still populated.
    if (this.selectedCardIds.has(sprite.card.id)) {
      sprite.setRing(hexToNum(this.theme.gameTheme.cardRing));
      return;
    }
    const card = sprite.card;
    if (state.attackingCardIds?.includes(card.id)) {
      sprite.setRing(hexToNum(this.theme.gameTheme.promptAction.attackAction));
    } else if (state.pendingCardIds?.includes(card.id)) {
      sprite.setRing(hexToNum(this.theme.gameTheme.promptAction.passAction));
    } else if (state.tappableLandIds?.includes(card.id)) {
      sprite.setRing(hexToNum(this.theme.gameTheme.cardRing));
    } else if (state.untappableLandIds?.includes(card.id)) {
      sprite.setRing(hexToNum(this.theme.gameTheme.promptAction.cancel));
    } else if (state.selectableCardIds?.includes(card.id)) {
      sprite.setRing(
        state.hostileTargeting
          ? hexToNum(this.theme.gameTheme.arrow.hostileTarget)
          : hexToNum(this.theme.gameTheme.cardRing),
      );
    } else if (this.isCreatureCard(card) && card.summoningSick) {
      sprite.setRing(hexToNum(this.theme.gameTheme.promptAction.cancel), 0.6);
    } else {
      sprite.setRing(null);
    }
  }

  private isCreatureCard(card: GameCard): boolean {
    return card.types?.some((t) => t.toLowerCase() === "creature") ?? false;
  }

  private rebuildBattlefieldOverlay(entry: SpriteEntry, state: BattlefieldState): void {
    const card = entry.sprite.card;
    const kind: ActionKind = {
      isTappable: state.tappableLandIds?.includes(card.id) ?? false,
      isUntappable: state.untappableLandIds?.includes(card.id) ?? false,
      isSelectable: !!(state.selectableCardIds?.includes(card.id) && this.callbacks.onClickCard),
    };

    if (!kind.isTappable && !kind.isUntappable && !kind.isSelectable) {
      if (entry.overlay) entry.overlay.visible = false;
      return;
    }

    const overlay = this.ensureOverlayContainer(entry);
    overlay.removeChildren().forEach((c) => c.destroy({ children: true }));

    const expandedMana =
      kind.isTappable && state.manaAbilityOptions
        ? getExpandedManaAbilities(card.id, state.manaAbilityOptions)
        : [];

    if (kind.isTappable && expandedMana.length > 1) {
      this.drawManaAbilityGrid(overlay, card, expandedMana);
    } else {
      this.drawSingleActionButton(overlay, card, state, kind);
    }

    overlay.visible = true;
  }

  private ensureOverlayContainer(entry: SpriteEntry): Container {
    if (entry.overlay) return entry.overlay;
    const overlay = new Container();
    // "passive" — the overlay container itself isn't hit-tested, but child
    // buttons with eventMode "static" can receive pointer events. "none"
    // would disable hit testing for the entire subtree.
    overlay.eventMode = "passive";
    overlay.alpha = 0;
    overlay.pivot.set(CARD_W / 2, CARD_H / 2);
    this.myBattlefieldContainer.addChild(overlay);
    entry.overlay = overlay;
    return overlay;
  }

  private drawManaAbilityGrid(
    overlay: Container,
    card: GameCard,
    abilities: ReturnType<typeof getExpandedManaAbilities>,
  ): void {
    const cols = abilities.length > 2 ? 2 : abilities.length;
    const rows = Math.ceil(abilities.length / cols);
    const btnW = CARD_W / cols;
    const btnH = CARD_H / rows;
    const isOddLast = abilities.length % 2 !== 0;

    abilities.forEach((ab, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const shouldSpan = cols === 2 && i === abilities.length - 1 && isOddLast;
      const currentW = shouldSpan ? CARD_W : btnW;

      const letters = extractManaLetters(ab.description);
      const letter = letters[0];
      const color = manaColorFor(letter, this.theme, hexToNum(this.theme.gameTheme.canvas.shadow));

      const btn = new Graphics();
      const paintBtn = (highlighted: boolean) => {
        btn.clear();
        btn.roundRect(col * btnW, row * btnH, currentW, btnH, CARD_RADIUS);
        btn.fill({
          color,
          alpha: highlighted ? MANA_BUTTON_HOVER_ALPHA : MANA_BUTTON_ALPHA,
        });
        btn.stroke({
          color: hexToNum(this.theme.gameTheme.canvas.neutral),
          width: 1,
          alpha: highlighted ? MANA_BUTTON_STROKE_HOVER_ALPHA : MANA_BUTTON_STROKE_ALPHA,
        });
      };
      paintBtn(false);
      overlay.addChild(btn);

      const icon = this.createManaIcon(
        letter ?? OVERLAY_LABEL_TAP,
        cols === 2 ? 10 : 12,
        cols === 2 ? 10 : 14,
      );
      icon.x = col * btnW + currentW / 2;
      icon.y = row * btnH + btnH / 2;
      overlay.addChild(icon);

      this.wireOverlayButton(
        btn,
        card.id,
        () => this.callbacks.onTapLandAbility?.(card.id, ab.abilityIndex, letter),
        (highlighted) => {
          paintBtn(highlighted);
          icon.scale.set(highlighted ? ICON_HOVER_SCALE : 1);
        },
      );
    });
  }

  private drawSingleActionButton(
    overlay: Container,
    card: GameCard,
    state: BattlefieldState,
    kind: ActionKind,
  ): void {
    const ring = hexToNum(this.theme.gameTheme.cardRing);
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
      color = hexToNum(this.theme.gameTheme.promptAction.cancel);
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

    this.wireOverlayButton(
      btn,
      card.id,
      () => this.dispatchBattlefieldAction(card, state, kind),
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
   * real drag, `pointertap` bails out via `justDraggedCardIds`.
   */
  private wireOverlayButton(
    btn: Graphics,
    cardId: string,
    onTap: () => void,
    onHoverChange?: (highlighted: boolean) => void,
  ): void {
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerover", () => {
      this.cancelBattlefieldHoverClear();
      const entry = this.entries.get(cardId);
      if (entry) this.setBattlefieldCardHovered(entry.sprite);
      onHoverChange?.(true);
    });
    btn.on("pointerout", () => {
      onHoverChange?.(false);
      this.scheduleBattlefieldHoverClear(cardId);
    });
    btn.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      const entry = this.entries.get(cardId);
      if (entry) this.onBattlefieldCardDown(entry.sprite, e);
    });
    btn.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (this.dragHandler.justDraggedCardIds.has(cardId)) return;
      onTap();
    });
  }

  private createManaIcon(label: string, fontSize: number, radius: number): Container {
    const icon = new Container();
    // Let pointer events pass through to the button graphic underneath.
    icon.eventMode = "none";
    const circle = new Graphics();
    circle.circle(0, 0, radius);
    circle.fill({ color: hexToNum(this.theme.gameTheme.canvas.shadow), alpha: ICON_BG_ALPHA });
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
          .then(() => this.refreshBattlefieldOverlays())
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

  private refreshBattlefieldOverlays(): void {
    if (!this.lastState) return;
    for (const entry of this.entries.values()) {
      if (entry.overlay?.visible) {
        this.rebuildBattlefieldOverlay(entry, this.lastState);
      }
    }
  }

  private dispatchBattlefieldAction(
    card: GameCard,
    state: BattlefieldState,
    kind: ActionKind,
  ): void {
    if (kind.isTappable) {
      const batch = this.selectedBatch(state.tappableLandIds, card.id);
      if (batch.length > 1) this.callbacks.onTapLands?.(batch);
      else this.callbacks.onTapLand?.(card);
    } else if (kind.isUntappable) {
      const batch = this.selectedBatch(state.untappableLandIds, card.id);
      if (batch.length > 1) this.callbacks.onUntapLands?.(batch);
      else this.callbacks.onUntapLand?.(card);
    } else if (kind.isSelectable) {
      this.callbacks.onClickCard?.(card);
    }
  }

  private selectedBatch(eligibleIds: string[] | undefined, cardId: string): string[] {
    if (!this.selectedCardIds.has(cardId) || this.selectedCardIds.size <= 1) return [];
    return [...this.selectedCardIds].filter((id) => eligibleIds?.includes(id));
  }

  // ═══════════════════════════════════════════════════════════════
  // Interaction (battlefield)
  // ═══════════════════════════════════════════════════════════════

  private onBattlefieldCardDown(sprite: CardSprite, e: FederatedPointerEvent): void {
    if (this.destroyed) return;
    // Opponent / read-only canvases never start a drag — the pointertap
    // handler on the sprite still fires and drives click-to-target.
    if (!this.allowDrag) return;
    this.callbacks.onHoverCard?.(null);
    const local = this.root.toLocal(e.global);
    this.selectedCardIds = this.dragHandler.start(
      sprite.card.id,
      local.x,
      local.y,
      this.selectedCardIds,
      this.snapshotCurrentPositions(),
      e.shiftKey,
    );
    this.drawSelectionBadge();
    this.refreshSelectionRings();
  }

  private onBackgroundDown(e: FederatedPointerEvent): void {
    if (this.destroyed) return;
    // Marquee / multi-select is a drag-mode behavior only.
    if (!this.allowDrag) return;
    const local = this.root.toLocal(e.global);
    if (!e.shiftKey) {
      this.selectedCardIds.clear();
      this.drawSelectionBadge();
      this.refreshSelectionRings();
    }
    this.marquee.start(local.x, local.y, e.shiftKey);
  }

  private onGlobalMove(e: FederatedPointerEvent): void {
    if (this.destroyed) return;
    const local = this.root.toLocal(e.global);
    if (this.marquee.isActive) {
      this.marquee.move(local.x, local.y);
      return;
    }

    const dragging =
      this.dragHandler.draggingCardIds.size > 0 || !!this.lastHandState?.draggingCardId;
    if (!dragging) {
      this.updateHandHoverAt(local.x, local.y);
    } else if (this.hoveredHandIndex !== null || this.pendingHandHoverLeaveIndex !== null) {
      this.resetHandHover();
    }

    const newPositions = this.dragHandler.move(local.x, local.y);
    if (!newPositions) return;
    // Active drag just crossed the move threshold — kill any hover preview
    // so it doesn't linger under the cursor while the user drags. Done here
    // (not at pointerdown) so a simple click that never moves doesn't also
    // dismiss the preview.
    this.callbacks.onDismissHoverPreview?.();
    // The hovered cell anchors multi-card drops, so we specifically need
    // the *primary* card's current cursor position — not just whichever
    // dragged card happens to be first in iteration order. Without this
    // a multi-card drag reads the wrong source cell and the delta
    // applied in `commitCellDrop` lands the group off by a few cells.
    const primaryId = this.dragHandler.primaryDraggingCardId;
    let primaryPos: Point | null = null;
    const draggingIds = this.dragHandler.draggingCardIds;
    for (const [id, pos] of newPositions) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      entry.targetX = pos.x;
      entry.targetY = pos.y;
      // Snap sprite (and its overlay) directly to the cursor so the card
      // tracks 1:1 during drag. Without this the battlefield lerp (0.15)
      // makes dragging feel draggy/sticky — the sprite chases the cursor
      // with ~150ms of visible lag.
      entry.sprite.x = pos.x;
      entry.sprite.y = pos.y;
      if (entry.overlay?.visible) {
        entry.overlay.x = pos.x;
        entry.overlay.y = pos.y;
      }
      if (id === primaryId || (!primaryPos && !primaryId)) primaryPos = pos;
      // Keep attached children (auras, equipment, UI stacks) stuck to the
      // parent as it moves — otherwise the pile visually tears apart and
      // the children stay where the parent used to be.
      this.followAttachmentsDuringDrag(id, pos);
    }

    // Resolve the cell under the drag cursor + whether the dragged card
    // would stack onto another permanent. Drives the skeleton overlay.
    if (primaryPos && this.gridInfo) {
      this.hoveredCell = cellFromPoint(this.gridInfo, primaryPos.x, primaryPos.y);
      this.stackTargetId = this.hoveredCell
        ? this.findStackTargetAt(this.hoveredCell, draggingIds)
        : null;
    } else {
      this.hoveredCell = null;
      this.stackTargetId = null;
    }
    this.drawGridSkeleton(draggingIds);
  }

  private onGlobalUp(): void {
    if (this.destroyed) return;
    if (this.marquee.isActive) {
      this.selectedCardIds = this.marquee.end(
        this.snapshotCurrentPositions(),
        this.selectedCardIds,
      );
      this.drawSelectionBadge();
      this.refreshSelectionRings();
      return;
    }

    // `end()` clears drag state, so snapshot ids before calling it — the
    // returned `positions` map is always empty in the handler's contract.
    const draggedIds = [...this.dragHandler.draggingCardIds];
    const primaryId = this.dragHandler.primaryDraggingCardId;
    const result = this.dragHandler.end();
    // Always hide the skeleton when the gesture ends — even on a plain
    // click-without-drag `end()` returns `wasDrag: false` and we still
    // need to clear any stale overlay state.
    const stackTargetId = this.stackTargetId;
    const hoveredCell = this.hoveredCell;
    this.stackTargetId = null;
    this.hoveredCell = null;
    this.gridSkeletonGfx.visible = false;
    this.gridSkeletonGfx.clear();

    if (!result?.wasDrag) return;
    // Collect the single "primary" cell/stack target from the first dragged
    // card — multi-drag just shifts siblings into adjacent cells around it.
    if (stackTargetId && draggedIds.length > 0) {
      this.commitStackDrop(draggedIds, stackTargetId);
    } else if (hoveredCell) {
      this.commitCellDrop(draggedIds, hoveredCell, primaryId);
    }

    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  /**
   * Children of `parentId` — both engine-defined attachments
   * (`card.attachmentIds`) and UI-level stacks stored in `uiParent`.
   * Order matches `updateBattlefield` so the attachment-offset staircase
   * during drag matches the steady-state layout.
   */
  private getEffectiveChildren(parentId: string): string[] {
    const parent = this.lastState?.cards.find((c) => c.id === parentId);
    const result: string[] = [];
    const seen = new Set<string>();
    if (parent?.attachmentIds) {
      for (const id of parent.attachmentIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(id);
      }
    }
    for (const [childId, pId] of this.uiParent) {
      if (pId !== parentId) continue;
      if (seen.has(childId)) continue;
      seen.add(childId);
      result.push(childId);
    }
    return result;
  }

  /**
   * While dragging `parentId`, reposition its attached children so they
   * track the parent 1:1. Mirrors the stack geometry used in
   * `updateBattlefield`: children peek above the parent with an
   * ATTACH_OFFSET_Y staircase. Sprite + overlay positions are snapped
   * directly (not lerped) to keep up with the cursor.
   */
  private followAttachmentsDuringDrag(parentId: string, parentCenter: Point): void {
    const children = this.getEffectiveChildren(parentId);
    if (children.length === 0) return;
    const cardH = CARD_H * this.cardScale;
    const totalOffset = children.length * ATTACH_OFFSET_Y;
    const topLeftY = parentCenter.y - totalOffset - cardH / 2;
    // Parent itself is shifted down by totalOffset so the child staircase
    // can peek above it — match that offset for the sprite in hand here.
    const parentEntry = this.entries.get(parentId);
    if (parentEntry) {
      const parentCy = topLeftY + totalOffset + cardH / 2;
      parentEntry.targetY = parentCy;
      parentEntry.sprite.y = parentCy;
      if (parentEntry.overlay?.visible) parentEntry.overlay.y = parentCy;
    }
    for (let i = 0; i < children.length; i++) {
      const childId = children[i]!;
      const child = this.entries.get(childId);
      if (!child) continue;
      const cy = topLeftY + totalOffset - (children.length - i) * ATTACH_OFFSET_Y + cardH / 2;
      child.targetX = parentCenter.x;
      child.targetY = cy;
      child.sprite.x = parentCenter.x;
      child.sprite.y = cy;
      if (child.overlay?.visible) {
        child.overlay.x = parentCenter.x;
        child.overlay.y = cy;
      }
    }
  }

  /**
   * Find a top-level battlefield card occupying `cell` whose id isn't in
   * `exclude`. Used during drag to detect a stack target under the cursor.
   */
  private findStackTargetAt(cell: GridCell, exclude: Set<string>): string | null {
    if (!this.gridInfo) return null;
    for (const [id, pos] of this.gridTargets) {
      if (exclude.has(id)) continue;
      const c = cellFromPoint(this.gridInfo, pos.x, pos.y);
      if (c && c.col === cell.col && c.row === cell.row) return id;
    }
    return null;
  }

  /**
   * Snap one or more dragged cards onto the grid. Translates every card
   * in the selection by the same (col, row) delta the user applied to
   * the primary card (the card they actually grabbed), so multi-card
   * selections preserve their relative layout. If a translated cell is
   * blocked / occupied / out-of-bounds for a given card, that card
   * falls back to the nearest free cell near its intended destination
   * (spiral search). Cards for which we can't find any free cell keep
   * their existing slot. Clears any prior UI attachments on the dragged
   * cards so they visually detach from previous stacks.
   */
  private commitCellDrop(draggedIds: string[], target: GridCell, primaryId: string | null): void {
    if (!this.gridInfo || draggedIds.length === 0) return;
    const grid = this.gridInfo;

    // Snapshot the source cell of every dragged card. Used both to drive
    // the delta translation and to free those cells from the reserved
    // set (so another dragged card can occupy them if the layout shifts).
    const sourceCell = new Map<string, GridCell>();
    for (const id of draggedIds) {
      const pos = this.gridTargets.get(id);
      if (!pos) continue;
      const cell = cellFromPoint(grid, pos.x, pos.y);
      if (cell) sourceCell.set(id, cell);
    }

    // Delta from the primary's current cell to the target cell the user
    // hovered. Every other dragged card translates by the same offset.
    const primary = primaryId && sourceCell.has(primaryId) ? primaryId : draggedIds[0]!;
    const primarySrc = sourceCell.get(primary);
    const dCol = primarySrc ? target.col - primarySrc.col : 0;
    const dRow = primarySrc ? target.row - primarySrc.row : 0;

    // Reserve cells held by non-dragged cards. We *don't* reserve the
    // dragged cards' source cells because the translation may reassign
    // them to other dragged cards.
    const draggedSet = new Set(draggedIds);
    const reserved = new Set<string>();
    for (const [id, pos] of this.gridTargets) {
      if (draggedSet.has(id)) continue;
      const c = cellFromPoint(grid, pos.x, pos.y);
      if (c) reserved.add(cellKey(c.col, c.row));
    }

    for (const id of draggedIds) {
      this.uiParent.delete(id);
      const src = sourceCell.get(id);
      const wantCol = (src?.col ?? target.col) + dCol;
      const wantRow = (src?.row ?? target.row) + dRow;

      // Try the translated cell first; if it's blocked / occupied /
      // out-of-bounds, spiral out from it for the nearest free cell.
      let placed: GridCell | null = null;
      const wantCell = cellAt(grid, wantCol, wantRow);
      if (wantCell && !wantCell.blocked && !reserved.has(cellKey(wantCell.col, wantCell.row))) {
        placed = wantCell;
      } else {
        const anchorX = wantCell?.cx ?? target.cx + dCol * grid.cellW;
        const anchorY = wantCell?.cy ?? target.cy + dRow * grid.cellH;
        for (const cell of cellsByDistance(grid, anchorX, anchorY)) {
          if (cell.blocked) continue;
          if (reserved.has(cellKey(cell.col, cell.row))) continue;
          placed = cell;
          break;
        }
      }

      if (placed) {
        reserved.add(cellKey(placed.col, placed.row));
        this.userSlots.set(id, { col: placed.col, row: placed.row });
        this.userPlacedCards.add(id);
      }
    }
  }

  /**
   * Attach each dragged card to `targetId` in the UI-only stack map and
   * drop any user slots they held — the parent's slot controls their
   * rendered position once stacked.
   */
  private commitStackDrop(draggedIds: string[], targetId: string): void {
    for (const id of draggedIds) {
      if (id === targetId) continue;
      // Avoid trivial cycles — if the target is already attached under the
      // dragged card, drop that relationship first.
      if (this.uiParent.get(targetId) === id) this.uiParent.delete(targetId);
      this.uiParent.set(id, targetId);
      this.userSlots.delete(id);
      this.userPlacedCards.delete(id);
    }
  }

  private snapshotCurrentPositions(): Map<string, Point> {
    const positions = new Map<string, Point>();
    for (const [id, entry] of this.entries) {
      positions.set(id, { x: entry.sprite.x, y: entry.sprite.y });
    }
    return positions;
  }

  private drawSelectionBadge(): void {
    if (this.selectedCardIds.size === 0) {
      this.selectionBadge.visible = false;
      return;
    }
    this.selectionBadge.text = `${this.selectedCardIds.size} selected`;
    this.selectionBadge.visible = true;
    const zone = this.getPlayZone();
    this.selectionBadge.x = zone.x + zone.width - this.selectionBadge.width - 8;
    this.selectionBadge.y = zone.y + 6;
  }

  private refreshSelectionRings(): void {
    if (!this.lastState) return;
    for (const entry of this.entries.values()) {
      if (this.selectedCardIds.has(entry.sprite.card.id)) {
        entry.sprite.setRing(hexToNum(this.theme.gameTheme.cardRing));
      } else {
        this.applyBattlefieldRing(entry.sprite, this.lastState);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Hand
  // ═══════════════════════════════════════════════════════════════

  private pruneRemovedHandSprites(currentIds: Set<string>): void {
    for (const [id, sprite] of this.handSprites) {
      if (currentIds.has(id)) continue;
      this.handContainer.removeChild(sprite);
      safeDestroy(sprite);
      this.handSprites.delete(id);
      this.handTargets.delete(id);
    }
  }

  /**
   * Seed position + uniform scale for a brand-new battlefield sprite that
   * has no live hand sprite to mirror. Anchors the drop animation at the
   * hand-fan center (or the zone's far edge for mirrored / hand-less
   * opponent canvases) so cards always appear to arrive from off-board.
   * Scale matches the current hand so the size lerp covers the same
   * distance as the position lerp.
   */
  /** Single source of truth for the hand's vertical anchor point.
   *  The offset fraction controls how much of each hand card peeks above
   *  the zone bottom — `0.45` means 55% of the card is visible and the
   *  hand stays clear of the third battlefield row. */
  private handBottomY(): number {
    const zone = this.getPlayZone();
    const dims = this.computeHandDimensions();
    return zone.y + zone.height + dims.cardH * 0.45;
  }

  private computeHandOriginSeed(): { x: number; y: number; scale: number } {
    const zone = this.getPlayZone();
    const dims = this.computeHandDimensions();
    // Opponent (mirrored / showHand=false) sends cards in from the TOP
    // edge of their zone since their "hand" lives off the screen above.
    const y =
      this.mirrored || !this.showHand
        ? zone.y + dims.cardH / 2
        : this.handBottomY() - dims.cardH / 2;
    return {
      x: zone.x + zone.width / 2,
      y,
      scale: dims.cardW / CARD_W,
    };
  }

  private computeHandDimensions() {
    const base = HAND_CARD_BASE;
    const params = HAND_FAN_PARAMS;
    // `vScale` comes from the `useHandScale` hook. Using it directly
    // keeps the Pixi hand consistent across mulligan and normal play.
    const scale = this.vScale;
    const cardW = Math.round(base.cardW * scale);
    const available = Math.max(cardW, this.getPlayZone().width - cardW);
    return {
      cardW,
      cardH: Math.round(base.cardH * scale),
      hoverLift: Math.round(params.hoverLift * scale),
      neighborPush: Math.round(params.neighborPush * scale),
      maxSpread: Math.round(params.maxSpread * scale),
      minSpread: Math.round(params.minSpread * scale),
      spreadWidth: Math.min(Math.round(params.spreadWidth * scale), available),
    };
  }

  private createHandSprite(card: GameCard): CardSprite {
    const sprite = new CardSprite(card);
    sprite.eventMode = "static";
    sprite.cursor = card.isPlayable ? "grab" : "default";

    sprite.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (this.lastHandState?.selectionMode) {
        this.callbacks.onClickCard_Hand?.(sprite.card);
        return;
      }
      if (sprite.card.isPlayable) {
        this.callbacks.onStartDrag?.(sprite.card, {
          x: e.globalX,
          y: e.globalY,
        });
      } else {
        this.callbacks.onClickCard_Hand?.(sprite.card);
      }
    });

    this.handContainer.addChild(sprite);
    this.handSprites.set(card.id, sprite);
    return sprite;
  }

  private updateHandHoverAt(x: number, y: number): void {
    const hit = this.handHitAt(x, y);
    if (!hit) {
      this.clearHandHover();
      return;
    }
    this.setHandHovered(hit);
  }

  private setHandHovered(hit: HandHitZone): void {
    const changed = this.hoveredHandIndex !== hit.index;
    const wasPending = this.pendingHandHoverLeaveIndex !== null;
    this.cancelHandHoverHoldTimer();
    if (!changed && !wasPending) return;
    this.hoveredHandIndex = hit.index;
    if (changed) this.recalcHandTargets();
    const sprite = this.handSprites.get(hit.card.id);
    if (!sprite) return;
    const screenBounds = this.hoveredHandSpriteBounds(sprite);
    this.callbacks.onHoverCard?.(hit.card, screenBounds, {
      useAnchor: true,
      placement: "top-center",
    });
    this.callbacks.onHoverHandCard?.(hit.card, screenBounds);
  }

  private resetHandHover(): void {
    this.cancelHandHoverHoldTimer();
    this.callbacks.onHoverCard?.(null);
    this.callbacks.onHoverHandCard?.(null);
    if (this.hoveredHandIndex !== null) {
      this.hoveredHandIndex = null;
      this.recalcHandTargets();
    }
  }

  private clearHandHover(): void {
    const idx = this.hoveredHandIndex;
    if (idx === null) return;
    if (this.pendingHandHoverLeaveIndex === idx && this.handHoverHoldTimer !== null) return;
    this.callbacks.onHoverCard?.(null);
    this.callbacks.onHoverHandCard?.(null);
    this.scheduleHandHoverCommit(idx);
  }

  private handHitAt(x: number, y: number): HandHitZone | null {
    let best: HandHitZone | null = null;
    let bestDistance = Infinity;
    for (const zone of this.handHitZones) {
      const left = zone.x - zone.width / 2;
      const right = zone.x + zone.width / 2;
      const top = zone.y - zone.height / 2;
      const bottom = zone.y + zone.height / 2;
      if (x < left || x > right || y < top || y > bottom) continue;
      const distance = Math.abs(x - zone.x);
      if (
        distance < bestDistance ||
        (distance === bestDistance && best && zone.index > best.index)
      ) {
        best = zone;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Analytical bounds for the hovered hand sprite in canvas coordinates.
   * The position and scale are both animated, so reading the target instead of
   * the live sprite anchors overlays to the settled hover pose, not the
   * mid-lerp one.
   */
  private hoveredHandSpriteBounds(sprite: CardSprite): ScreenBounds {
    const target = this.handTargets.get(sprite.card.id);
    const centerX = target?.x ?? sprite.x;
    const centerY = target?.y ?? sprite.y;
    const width = CARD_W * (target?.scaleX ?? sprite.scale.x);
    const height = CARD_H * (target?.scaleY ?? sprite.scale.y);
    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    };
  }

  private scheduleHandHoverCommit(idx: number): void {
    this.cancelHandHoverHoldTimer();
    this.pendingHandHoverLeaveIndex = idx;
    this.handHoverHoldTimer = window.setTimeout(() => {
      this.commitHandHoverLeave();
    }, HAND_HOVER_HOLD_MS);
  }

  private commitHandHoverLeave(): void {
    this.handHoverHoldTimer = null;
    const idx = this.pendingHandHoverLeaveIndex;
    this.pendingHandHoverLeaveIndex = null;
    if (this.destroyed) return;
    if (idx === null || this.hoveredHandIndex !== idx) return;
    this.hoveredHandIndex = null;
    this.recalcHandTargets();
  }

  private cancelHandHoverHoldTimer(): void {
    if (this.handHoverHoldTimer !== null) {
      window.clearTimeout(this.handHoverHoldTimer);
      this.handHoverHoldTimer = null;
    }
    this.pendingHandHoverLeaveIndex = null;
  }

  /** Called when the HTML action menu receives the cursor. */
  holdHandHover(): void {
    this.cancelHandHoverHoldTimer();
  }

  /** Called when the cursor leaves the HTML action menu. */
  releaseHandHover(): void {
    if (this.hoveredHandIndex === null) return;
    this.scheduleHandHoverCommit(this.hoveredHandIndex);
  }

  private applyHandCardHighlight(
    sprite: CardSprite,
    card: GameCard,
    isHovered: boolean,
    selectionMode = false,
    isSelected = false,
    isCasting = false,
  ): void {
    if (isCasting) {
      const cast = hexToNum(this.theme.gameTheme.arrow.friendlyTarget);
      sprite.setHighlight(true, cast, CAST_DRAG_HIGHLIGHT_ALPHA);
      return;
    }
    if (selectionMode) {
      const color = isSelected
        ? hexToNum(this.theme.gameTheme.pointer.hostile)
        : hexToNum(this.theme.gameTheme.cardRing);
      sprite.setRing(color, isSelected ? 1 : PLAYABLE_RING_ALPHA);
      return;
    }
    if (!card.isPlayable) {
      sprite.setRing(null);
      return;
    }
    const ring = hexToNum(this.theme.gameTheme.cardRing);
    if (isHovered) sprite.setHighlight(true, ring, PLAYABLE_HIGHLIGHT_ALPHA);
    else sprite.setRing(ring, PLAYABLE_RING_ALPHA);
  }

  private recalcHandTargets(): void {
    if (this.lastHandState) this.updateHand(this.lastHandState);
  }

  // ═══════════════════════════════════════════════════════════════
  // Per-frame animation
  // ═══════════════════════════════════════════════════════════════

  private tick = (): void => {
    for (const entry of this.entries.values()) this.animateBattlefieldSprite(entry);
    for (const [id, target] of this.handTargets) {
      const sprite = this.handSprites.get(id);
      if (sprite) this.animateHandSprite(sprite, target);
    }
    this.captureStackSeeds();
    this.resolveAndDrawArrows();
    if (this.dropActive) this.drawDropVisual();
  };

  /**
   * Scan the DOM for live stack cards and refresh their last-known
   * canvas-local center + rendered scale. Entries older than the TTL are
   * evicted so we don't seed a new battlefield sprite from a stale
   * position if the same card comes back through the stack much later.
   */
  private captureStackSeeds(): void {
    const canvasRect = this.app.canvas.getBoundingClientRect();
    const now = performance.now();
    const els = document.querySelectorAll<HTMLElement>("[data-stack-object-id][data-card-id]");
    for (const el of els) {
      const cardId = el.dataset["cardId"];
      if (!cardId) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      this.stackCardSeeds.set(cardId, {
        x: r.left + r.width / 2 - canvasRect.left,
        y: r.top + r.height / 2 - canvasRect.top,
        scale: r.width / CARD_W,
        ts: now,
      });
    }
    for (const [id, seed] of this.stackCardSeeds) {
      if (now - seed.ts > STACK_SEED_TTL_MS) this.stackCardSeeds.delete(id);
    }
  }

  /**
   * Resolve each arrow spec's endpoints to canvas-local coordinates using
   * the scene's live sprite maps, falling back to DOM queries for entities
   * that don't live in the canvas (player panels, React-rendered stack).
   * Runs every tick so arrows follow animating sprites.
   */
  private resolveAndDrawArrows(): void {
    const hasCastDrag =
      this.showHand &&
      this.lastHandState?.draggingCardId != null &&
      this.lastHandState?.draggingIsPermanent === true;
    const hasAny = this.arrowSpecs.length > 0 || this.castingArrow !== null || hasCastDrag;
    if (!hasAny) {
      if (this.arrowLayer && !this.arrowLayer.isClear) {
        this.arrowLayer.update([], this.app.ticker.deltaMS);
      }
      return;
    }
    // Cache the canvas rect once so each DOM query doesn't re-trigger layout.
    const canvasRect = this.app.canvas.getBoundingClientRect();
    const resolved: ArrowDef[] = [];
    for (const spec of this.arrowSpecs) {
      const from = this.resolveArrowEndpoint(spec.from, canvasRect);
      const to = this.resolveArrowEndpoint(spec.to, canvasRect);
      if (!from || !to) continue;
      resolved.push({
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        type: spec.type,
      });
    }
    const casting = this.resolveCastingArrow(canvasRect);
    if (casting) resolved.push(casting);
    const castDrag = this.resolveCastDragArrow(canvasRect);
    if (castDrag) resolved.push(castDrag);
    this.arrowLayer.update(resolved, this.app.ticker.deltaMS);
  }

  private resolveCastDragArrow(canvasRect: DOMRect): ArrowDef | null {
    if (!this.showHand) return null;
    const id = this.lastHandState?.draggingCardId;
    if (!id) return null;
    // Only permanents use the placement arrow; instants/sorceries drag a ghost.
    if (this.lastHandState?.draggingIsPermanent !== true) return null;
    const sprite = this.handSprites.get(id);
    if (!sprite) return null;
    return {
      fromX: sprite.x,
      fromY: sprite.y,
      toX: this.cursorViewportX - canvasRect.left,
      toY: this.cursorViewportY - canvasRect.top,
      type: "cast",
    };
  }

  private resolveCastingArrow(canvasRect: DOMRect): ArrowDef | null {
    const spec = this.castingArrow;
    if (!spec) return null;

    const from = this.domCenterCanvasLocal(
      `[data-casting-card="${CSS.escape(spec.castingCardId)}"]`,
      canvasRect,
    );
    if (!from) return null;

    // Locked target -> try card first, then player.
    let to: ScreenPos | null = null;
    if (spec.targetId) {
      to =
        this.resolveArrowEndpoint({ kind: "card", id: spec.targetId }, canvasRect) ??
        this.resolveArrowEndpoint({ kind: "player", id: spec.targetId }, canvasRect);
    } else {
      // Free endpoint — follow the cursor, translated to canvas-local.
      to = {
        x: this.cursorViewportX - canvasRect.left,
        y: this.cursorViewportY - canvasRect.top,
      };
    }
    if (!to) return null;

    // Casting arrow is rendered exclusively by the overlay `PointerLayer`
    // now — no matching arrow type exists on the main-scene arrow layer.
    void from;
    void to;
    void spec;
    return null;
  }

  private resolveArrowEndpoint(ep: ArrowEndpoint, canvasRect: DOMRect): ScreenPos | null {
    switch (ep.kind) {
      case "card": {
        const entry = this.entries.get(ep.id);
        if (entry) return { x: entry.targetX, y: entry.targetY };
        const handSprite = this.handSprites.get(ep.id);
        if (handSprite) {
          const target = this.handTargets.get(ep.id);
          // Prefer the target position so arrows point at where the sprite
          // is heading during animations — prevents the arrow from lagging
          // behind a lifting hand card.
          return target ? { x: target.x, y: target.y } : { x: handSprite.x, y: handSprite.y };
        }
        return this.domCenterCanvasLocal(`[data-card-id="${CSS.escape(ep.id)}"]`, canvasRect);
      }
      case "player":
        return this.domCenterCanvasLocal(`[data-player-id="${CSS.escape(ep.id)}"]`, canvasRect);
      case "stack":
        return this.domCenterCanvasLocal(
          `[data-stack-object-id="${CSS.escape(ep.id)}"]`,
          canvasRect,
        );
      case "placement-ghost": {
        const slot = this.findFirstFreeBattlefieldSlot();
        return { x: slot.x + CARD_W / 2, y: slot.y + CARD_H / 2 };
      }
    }
  }

  private domCenterCanvasLocal(selector: string, canvasRect: DOMRect): ScreenPos | null {
    // The same element may be duplicated across responsive layouts
    // (e.g. mobile-only <main class="md:hidden"> alongside desktop).
    // Walk all matches and use the first one that's actually laid out
    // — picking the DOM-first match would silently bail when it lives
    // in a hidden ancestor.
    const els = document.querySelectorAll(selector);
    for (const el of els) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      return {
        x: r.left + r.width / 2 - canvasRect.left,
        y: r.top + r.height / 2 - canvasRect.top,
      };
    }
    return null;
  }

  private animateBattlefieldSprite(entry: SpriteEntry): void {
    const s = entry.sprite;
    s.x = lerp(s.x, entry.targetX, BATTLEFIELD_LERP, SNAP_PX);
    s.y = lerp(s.y, entry.targetY, BATTLEFIELD_LERP, SNAP_PX);
    s.rotation = lerp(s.rotation, entry.targetRotation, ROTATION_LERP, SNAP_ROT);
    s.zIndex = entry.targetZIndex;

    if (entry.etbGlowAlpha > 0) {
      entry.etbGlowAlpha = lerp(entry.etbGlowAlpha, 0, OVERLAY_FADE_LERP, SNAP_ALPHA);
    }
    s.setEntryGlowAlpha(entry.etbGlowAlpha);

    const isHovered = this.hoveredCardId === s.card.id;
    const targetScale = this.cardScale * (isHovered ? HOVER_SCALE : 1);
    const nextScale = lerp(s.scale.x, targetScale, HOVER_SCALE_LERP, SNAP_SCALE);
    s.scale.set(nextScale);

    if (entry.overlay?.visible) {
      entry.overlay.x = s.x;
      entry.overlay.y = s.y;
      entry.overlay.zIndex = entry.targetZIndex + Z_OVERLAY_OFFSET;
      entry.overlay.alpha = lerp(
        entry.overlay.alpha,
        isHovered ? 1 : 0,
        OVERLAY_FADE_LERP,
        SNAP_ALPHA,
      );
    }
  }

  private animateHandSprite(sprite: CardSprite, target: HandTarget): void {
    sprite.x = lerp(sprite.x, target.x, HAND_LERP, SNAP_PX);
    sprite.y = lerp(sprite.y, target.y, HAND_LERP, SNAP_PX);
    sprite.rotation = lerp(sprite.rotation, target.rot, HAND_LERP, SNAP_ROT);
    sprite.scale.set(
      lerp(sprite.scale.x, target.scaleX, HAND_LERP, SNAP_HAND_SCALE),
      lerp(sprite.scale.y, target.scaleY, HAND_LERP, SNAP_HAND_SCALE),
    );
    sprite.zIndex = target.zIndex;
  }
}

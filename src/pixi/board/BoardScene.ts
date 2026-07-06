import {
  Application,
  Container,
  FillGradient,
  Graphics,
  Point,
  Rectangle,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import { darken, withAlpha } from "@/themes/gameTheme";
import type { CardDto, PlaymatSettings } from "@/protocol/game";
import type { AttackTargetDto } from "@/protocol/prompts/common";
import {
  CardSprite,
  setCardSpriteTheme,
  setCardSpriteStyle,
  setCardSpriteHoverDebug,
} from "../CardSprite";
import type { BattlefieldCardStyle } from "@/stores/usePreferencesStore";
import { hexToNum } from "../colorUtils";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import type { ArrowDef } from "../ArrowLayer";
import {
  PhaseStripLayer,
  type PhaseStripCallbacks,
  type PhaseStripState,
} from "../PhaseStripLayer";
import { DragHandler } from "../DragHandler";
import { cellFromPoint, type GridCell } from "../GridLayout";
import { prewarmManaSymbols } from "../manaSymbolCache";
import { CARD_H } from "@/components/game/game.constants";
import { isCoarsePointer } from "@/lib/responsive";
import { LongPressGesture } from "../LongPressGesture";
import {
  BATTLEFIELD_HOVER_HOLD_MS,
  BG_ALPHA_IDLE,
  FLOATER_FONT_SIZE,
  FLOATER_LIFETIME_FRAMES,
  FLOATER_RISE_PER_FRAME,
  FPS_SAMPLE_INTERVAL_MS,
  PHASE_STRIP_COMBAT_ALPHA,
  STACK_SEED_TTL_MS,
  TABLE_RADIUS,
  Z_STAGED_REGION,
  Z_COMBAT_GUEST,
  HAND_RESERVE_TRIM,
  HAND_RESERVE_TRIM_COMPACT,
} from "../constants";
import { useGameDevStore } from "@/stores/useGameDevStore";
import type {
  ArrowEndpoint,
  ArrowSpec,
  BattlefieldState,
  GameCanvasCallbacks,
  HandState,
  PlayZoneRect,
  ScreenPos,
} from "../types";
import type { StackAnchorProvider } from "../stack/stack.types";
import { BoardRegion } from "./BoardRegion";
import type { ZoneTileSpec } from "./BoardZoneTiles";
import {
  PlayerHudLayer,
  PLAYER_HUD_HEIGHT_PX as PLAYER_BAR_HEIGHT_PX,
  SELF_PLAYER_HUD_HEIGHT_PX as SELF_PLAYER_BAR_HEIGHT_PX,
  SELF_PLAYER_HUD_COMPACT_SCALE,
  PLAYER_HUD_TOP_MARGIN_PX as PLAYER_BAR_TOP_MARGIN_PX,
  PLAYER_HUD_SIDE_MARGIN_PX as PLAYER_BAR_SIDE_MARGIN_PX,
  PLAYER_HUD_MAX_WIDTH_PX as PLAYER_BAR_MAX_WIDTH_PX,
} from "@/pixi/hud/PlayerHudLayer";
import type { PlayerHudSpec as PlayerBarSpec } from "@/pixi/hud/playerHud.types";
import { isAttackerTap } from "./combatRouting";
import { BattlefieldOverlay } from "./BattlefieldOverlay";
import { HandController } from "./HandController";
import { SelectionController } from "./SelectionController";
import {
  COLLAPSED_OPPONENT_WIDTH_PX,
  STRIP_BAND_PX,
  type BoardLayout,
  type RegionOrientation,
} from "./boardLayout";
import type {
  BlockingRect,
  HandHost,
  OverlayHost,
  RegionHost,
  SceneCombatStaging,
  SelectionHost,
  StagedBlocker,
} from "./types";

export interface BoardPlayerSpec {
  playerId: string;
  isLocal: boolean;
  playmat?: string;
  playmatSettings?: PlaymatSettings;
  /** Seat colour (hex) for the hover highlight. */
  color?: string;
}

/** Delimiter auto-focus easing (tweak freely). `FACTOR` is the fraction of the
 *  remaining distance closed each frame; `SNAP` is the width-fraction threshold
 *  at which the ease finishes and pins to the target. */
const DELIMITER_EASE = { FACTOR: 0.25, SNAP: 0.0005 } as const;

const COARSE_POINTER = isCoarsePointer();
const GRIP_HIT_WIDTH_PX = COARSE_POINTER ? 32 : 16;
const RECT_SCRATCH_A = new Point();
const RECT_SCRATCH_B = new Point();
const BOARD_ZOOM_MAX = 2.25;
const BOARD_ZOOM_SNAP_BACK = 1.05;
const ATTACK_ARROW_LANE_PX = 18;
/** Extra px around a planeswalker/battle card that still counts as targeting it
 *  while dragging an attacker — makes small opponent permanents easy to hit. */
const ATTACK_TARGET_HIT_PAD = 44;

/* ─────────────────────────────────────────────────────────────────────────
 * DIVIDER + FOG — tweak these. The vertical divider bar and the fog-of-war
 * fade beside it share ONE colour and ONE peak opacity, so the fog merges
 * seamlessly into the bar. The colour is a gently darkened canvas background
 * (see `dividerColor()` / `DIVIDER.darken`) — the field felt is already
 * canvas-background-coloured, so a same-colour separator is invisible against
 * it; the darken is the minimum distinct shade that reads as a seam without
 * going near-black. Tune `DIVIDER.darken` up for a clearer line, down softer.
 *   - alpha       opacity of the bar AND the fog at its darkest (right at the
 *                 divider). The fog is always this dark next to the divider, no
 *                 matter how collapsed the field is.
 *   - fadeWidthPx how far the fog leaks into a fully-collapsed field. Scales
 *                 DOWN with expansion (0 once a field is fully expanded), so it
 *                 controls the spread only — never the darkness at the divider.
 *   - barWidthPx  thickness of the divider bar.
 * ───────────────────────────────────────────────────────────────────────── */

const DIVIDER = {
  /** How much to darken the canvas background for the bar + fog. The field felt
   *  is already canvas-background-coloured, so a same-colour separator is
   *  invisible against it — this is the minimum distinct shade that still
   *  reads. Tune up for a clearer seam, down for a softer one. */
  darken: 0.2,
  alpha: 1,
  fadeWidthPx: 0,
  barWidthPx: 4,
} as const;

/** `count - 1` evenly-spaced delimiter positions (fractions of width). */
function evenDelimiters(count: number): number[] {
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) => (i + 1) / count);
}

interface RegionRecord {
  region: BoardRegion;
  zone: PlayZoneRect;
  isLocal: boolean;
}

export class BoardScene {
  private app: Application;
  private callbacks: GameCanvasCallbacks;
  private theme: Theme;
  private root: Container;
  private baseBg: Graphics;
  private collapseVeil: Graphics;
  private canvasW = 0;
  private canvasH = 0;
  private destroyed = false;
  private perfFrames = 0;
  private perfTotalDelta = 0;
  private perfMinFps = Infinity;
  private perfMaxFps = 0;
  private perfLastFlush = 0;

  private regions = new Map<string, RegionRecord>();
  private localPlayerId: string | null = null;
  private cardScale = 1;

  private floaterLayer: Container;
  private floaters: { text: Text; age: number }[] = [];
  private combatGuestLayer: Container;

  private declareBlockers = false;
  private blockDragBlockerId: string | null = null;
  private declareAttackers = false;
  private attackTargets: AttackTargetDto[] = [];
  private attackerOptions: { attackerId: string; validTargetIds: string[] }[] = [];
  // The legal attacker under a pointer-down, armed into an attack drag only once
  // the pointer actually moves — so a plain tap still reaches the click handler.
  private attackDragCandidate: string | null = null;
  private activeGesturePointerId: number | null = null;
  private longPress = new LongPressGesture();
  private pinchPointers = new Map<number, { x: number; y: number }>();
  private pinchStart: {
    dist: number;
    scale: number;
    world: { x: number; y: number };
  } | null = null;
  private pinchDownListener: (e: PointerEvent) => void;
  private stripOutsideListener: (e: PointerEvent) => void;
  private gestureCancelListener: (e: PointerEvent) => void;
  private pinchMoveListener: (e: PointerEvent) => void;
  private pinchUpListener: (e: PointerEvent) => void;
  private attackDragAttackerId: string | null = null;
  private attackDragTargetId: string | null = null;
  // Dragging one of our own already-declared attackers (staged as a guest in an
  // opponent's band) back toward our field to un-declare it.
  private unassignDrag: { cardId: string; region: BoardRegion; overOwn: boolean } | null = null;
  private phaseStripAlphaTarget = 1;
  private stripBandPx = STRIP_BAND_PX;
  private compactMode = false;
  private tapSuppressedPointers = new Set<number>();

  private hand: HandController | null = null;
  private selection: SelectionController | null = null;
  private overlay: BattlefieldOverlay | null = null;
  private dragHandler: DragHandler;
  private phaseStrip: PhaseStripLayer;
  private stripBackgroundGfx: Graphics;
  private lastLayout: BoardLayout | null = null;

  private arrowSpecs: ArrowSpec[] = [];
  private castingArrow: { sourceCardId: string; hostile: boolean } | null = null;
  private stackCardSeeds = new Map<string, { x: number; y: number; scale: number; ts: number }>();
  private lastCardPositions = new Map<
    string,
    { x: number; y: number; scaleX: number; scaleY: number }
  >();
  private stackProvider: StackAnchorProvider | null = null;

  private hoveredCell: GridCell | null = null;
  private stackTargetId: string | null = null;
  private dropActive = false;

  private hoveredCardId: string | null = null;
  private hoveredRegionRef: BoardRegion | null = null;
  private hoverClearTimer: number | null = null;

  private handInsetLeft = 0;
  private handInsetRight = 0;
  private playerBlockers = new Map<string, BlockingRect[]>();
  private lastCapsuleRects = new Map<string, string>();
  private delimsWereMoving = false;
  private autoSort = false;
  private gridSkeletonDebug = false;
  private attackRowDebug = false;

  // Delimiters (opponent clip bands). Owned and eased here, not in React.
  // `delimCurrent`/`delimTarget` are `count - 1` ascending fractions of width.
  private boardWidth = 0;
  private topHeight = 0;
  private opponentIds: string[] = [];
  private delimCurrent: number[] = [];
  private delimTarget: number[] = [];
  private focusPlayerId: string | null = null;
  private combatFocusIds: string[] = [];
  private manualFocusId: string | null = null;
  private draggingDelim: number | null = null;
  private hoveredOpponentId: string | null = null;
  private gripLayer: Container;
  private gripHandles: Graphics[] = [];
  private fogGfx: Graphics;
  private fogGradRight: FillGradient | null = null;
  private fogGradLeft: FillGradient | null = null;
  private highlightGfx: Graphics;
  private playerBars: PlayerHudLayer;
  private barsEnabled = false;

  private cursorViewportX = 0;
  private cursorViewportY = 0;
  private cursorListener: (e: MouseEvent) => void;
  private canvasLeaveListener: () => void;
  private onStageMove = (e: FederatedPointerEvent): void => this.onGlobalMove(e);
  private onStageUp = (e: FederatedPointerEvent): void => this.onGlobalUp(e);

  constructor(app: Application, callbacks: GameCanvasCallbacks) {
    this.app = app;
    this.callbacks = callbacks;
    this.theme = getTheme();

    this.root = new Container();
    this.root.sortableChildren = true;
    app.stage.addChild(this.root);
    app.stage.eventMode = "static";

    // Solid page-background base behind everything (the canvas itself is
    // transparent). Gives the whole battlefield one consistent colour so the
    // collapsed player panels — drawn in the same colour — blend in seamlessly
    // instead of popping against the translucent felt.
    this.baseBg = new Graphics();
    this.baseBg.eventMode = "none";
    this.baseBg.zIndex = -1000;
    this.root.addChild(this.baseBg);

    this.dragHandler = new DragHandler();

    this.stripBackgroundGfx = new Graphics();
    this.stripBackgroundGfx.eventMode = "none";
    this.stripBackgroundGfx.zIndex = 5;
    this.root.addChild(this.stripBackgroundGfx);

    // Delimiter fog veils the field content (cards/zones) but sits BELOW the
    // player bars, so a collapsed field's avatar stays clear of the fog.
    this.fogGfx = new Graphics();
    this.fogGfx.eventMode = "none";
    this.fogGfx.zIndex = 5550;
    this.root.addChild(this.fogGfx);

    // Solid page-background veil over each opponent field, its opacity driven
    // by how collapsed the field is (computed every frame in `applyDelimiters`,
    // so it stays perfectly in sync with the delimiter ease). Sits above the
    // cards but below the player panels, which render on top of it.
    this.collapseVeil = new Graphics();
    this.collapseVeil.eventMode = "none";
    this.collapseVeil.zIndex = 5560;
    this.root.addChild(this.collapseVeil);

    this.highlightGfx = new Graphics();
    this.highlightGfx.eventMode = "none";
    this.highlightGfx.zIndex = 5500;
    this.root.addChild(this.highlightGfx);

    this.playerBars = new PlayerHudLayer(
      this.theme,
      (id) => this.callbacks.onTargetPlayer?.(id),
      (id) => {
        if (this.compactMode && this.isCollapsedOpponentBand(id)) {
          this.callbacks.onFocusOpponentField?.(id);
          return;
        }
        this.callbacks.onShowPlayerSheet?.(id);
      },
      () => this.callbacks.onShowBoardMenu?.(),
    );
    this.playerBars.container.zIndex = 5600;
    this.playerBars.container.visible = false;
    this.root.addChild(this.playerBars.container);

    this.gripLayer = new Container();
    this.gripLayer.zIndex = 6000;
    this.root.addChild(this.gripLayer);

    this.phaseStrip = new PhaseStripLayer(this.theme);
    this.phaseStrip.container.zIndex = 7000;
    this.phaseStrip.onExpandedChange = () => this.refreshPhaseStripDim();
    this.root.addChild(this.phaseStrip.container);

    this.combatGuestLayer = new Container();
    this.combatGuestLayer.sortableChildren = true;
    this.combatGuestLayer.zIndex = Z_COMBAT_GUEST;
    this.root.addChild(this.combatGuestLayer);

    this.floaterLayer = new Container();
    this.floaterLayer.eventMode = "none";
    this.floaterLayer.zIndex = 9000;
    this.root.addChild(this.floaterLayer);

    app.stage.on("pointermove", this.onStageMove);
    app.stage.on("pointerup", this.onStageUp);
    app.stage.on("pointerupoutside", this.onStageUp);

    this.cursorListener = (e: MouseEvent) => {
      this.cursorViewportX = e.clientX;
      this.cursorViewportY = e.clientY;
      const rect = this.app.canvas.getBoundingClientRect();
      this.updateHoveredOpponent(e.clientX - rect.left, e.clientY - rect.top);
    };
    window.addEventListener("pointermove", this.cursorListener);
    this.canvasLeaveListener = () => this.hand?.clearHover();
    this.app.canvas.addEventListener("pointerleave", this.canvasLeaveListener);

    this.pinchDownListener = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const rect = this.app.canvas.getBoundingClientRect();
      this.pinchPointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      if (this.pinchStart) this.tapSuppressedPointers.add(e.pointerId);
      else if (this.pinchPointers.size === 2) this.beginPinch();
    };
    this.pinchMoveListener = (e: PointerEvent) => {
      if (!this.pinchPointers.has(e.pointerId)) return;
      const rect = this.app.canvas.getBoundingClientRect();
      this.pinchPointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      if (this.pinchStart) this.updatePinch();
    };
    this.pinchUpListener = (e: PointerEvent) => {
      if (this.tapSuppressedPointers.has(e.pointerId)) {
        window.setTimeout(() => this.tapSuppressedPointers.delete(e.pointerId), 0);
      }
      if (!this.pinchPointers.delete(e.pointerId)) return;
      if (this.pinchPointers.size < 2) this.endPinch();
    };
    this.gestureCancelListener = (e: PointerEvent) => {
      this.localRegion()?.cancelZoneTileDragForPointer(e.pointerId);
      if (this.activeGesturePointerId === e.pointerId) this.abortActiveGesture();
    };
    window.addEventListener("pointercancel", this.gestureCancelListener);
    this.stripOutsideListener = (e: PointerEvent) => {
      if (!this.phaseStrip.isCompactExpanded()) return;
      const rect = this.app.canvas.getBoundingClientRect();
      const p = this.phaseStrip.container.toLocal(
        new Point(e.clientX - rect.left, e.clientY - rect.top),
      );
      this.phaseStrip.handleOutsidePointerDown(p.x, p.y);
    };
    this.app.canvas.addEventListener("pointerdown", this.stripOutsideListener);
    this.app.canvas.addEventListener("pointerdown", this.pinchDownListener);
    window.addEventListener("pointermove", this.pinchMoveListener);
    window.addEventListener("pointerup", this.pinchUpListener);
    window.addEventListener("pointercancel", this.pinchUpListener);

    app.ticker.add(this.tick, this);
    prewarmManaSymbols();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  get canvasElement(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }

  configure(
    players: BoardPlayerSpec[],
    layout: BoardLayout,
    scales: { self: number; opponent: number },
  ): void {
    if (this.destroyed) return;
    this.cardScale = scales.self;
    const seen = new Set<string>();
    let oppIndex = 0;

    for (const spec of players) {
      const opp = spec.isLocal ? null : layout.opponents[oppIndex++];
      const zone = opp?.rect ?? layout.self;
      const orientation: RegionOrientation = spec.isLocal ? "bottom" : (opp?.orientation ?? "top");
      const regionScale = spec.isLocal ? scales.self : scales.opponent;
      // The clip bands tile the canvas (no overlap), so z-order is cosmetic.
      const zIndex = spec.isLocal ? 100 : 50;
      seen.add(spec.playerId);
      const existing = this.regions.get(spec.playerId);
      if (existing) {
        existing.zone = zone;
        existing.region.container.zIndex = zIndex;
        existing.region.setZone(zone, orientation);
        existing.region.setCardScale(regionScale);
        existing.region.setPlaymatSettings(spec.playmatSettings);
        existing.region.setPlaymat(spec.playmat);
        continue;
      }
      const region = new BoardRegion(
        this.makeRegionHost(spec.playerId, spec.isLocal),
        this.root,
        zone,
        regionScale,
        { orientation },
      );
      region.setPlaymatSettings(spec.playmatSettings);
      region.setPlaymat(spec.playmat);
      region.container.zIndex = zIndex;
      region.setAutoSort(this.autoSort);
      region.setCompactZones(this.compactMode);
      region.setSkeletonDebug(this.gridSkeletonDebug);
      region.setAttackRowDebug(this.attackRowDebug);
      this.regions.set(spec.playerId, { region, zone, isLocal: spec.isLocal });
      if (spec.isLocal) {
        this.localPlayerId = spec.playerId;
        this.setupLocalControllers(region);
      }
    }

    this.boardWidth = layout.self.width;
    this.topHeight = layout.opponents[0]?.rect.height ?? 0;
    const oppIds = players.filter((p) => !p.isLocal).map((p) => p.playerId);
    const sameOpponents =
      oppIds.length === this.opponentIds.length &&
      oppIds.every((id, i) => id === this.opponentIds[i]);
    this.opponentIds = oppIds;
    if (!sameOpponents || this.delimCurrent.length !== oppIds.length - 1) {
      this.delimCurrent = evenDelimiters(oppIds.length);
      this.rebuildGripHandles();
    }
    this.recomputeDelimTarget();
    this.applyDelimiters();

    for (const [id, rec] of [...this.regions]) {
      if (seen.has(id)) continue;
      rec.region.destroy();
      this.regions.delete(id);
      if (this.localPlayerId === id) this.localPlayerId = null;
    }

    this.positionPhaseStrip(layout);
    const selfZone = this.localZone();
    this.dragHandler.setCardScale(scales.self);
    this.dragHandler.setContainerSize(this.app.renderer.width, this.app.renderer.height);
    if (selfZone && this.hand) this.dragHandler.setHandExclusion(this.hand.getBlockerRect());
    // Regions laid out above sampled capsule bounds from before this pass's
    // applyDelimiters/layoutSelfBar moved them (resize/rotation) — reconcile.
    this.refreshCapsuleBlockers();
  }

  /** Set which opponent's field auto-expands (their turn), or `null` for an even
   *  split (our turn). The delimiters ease to this in `tick`. */
  setOpponentFocus(playerId: string | null): void {
    if (this.focusPlayerId === playerId) return;
    this.focusPlayerId = playerId;
    this.recomputeDelimTarget();
  }

  /** Opponents being attacked this combat — expanded (even-split among them
   *  when more than one) over the turn focus, so combat is always visible. */
  setCombatFocus(playerIds: string[]): void {
    if (
      this.combatFocusIds.length === playerIds.length &&
      this.combatFocusIds.every((id, i) => id === playerIds[i])
    ) {
      return;
    }
    this.combatFocusIds = playerIds;
    this.recomputeDelimTarget();
  }

  /** Keyboard-cycled focus — an explicit single-field pick that wins over the
   *  combat and turn focus (hover still floats on top). Null releases it. */
  setManualFocus(playerId: string | null): void {
    if (this.manualFocusId === playerId) return;
    this.manualFocusId = playerId;
    this.recomputeDelimTarget();
  }

  private recomputeDelimTarget(): void {
    const n = this.opponentIds.length;
    // Precedence: hover (momentary) > manual keyboard pick > combat (the set of
    // attacked opponents) > turn focus.
    const focusIds = this.hoveredOpponentId
      ? [this.hoveredOpponentId]
      : this.manualFocusId
        ? [this.manualFocusId]
        : this.combatFocusIds.length > 0
          ? this.combatFocusIds
          : this.focusPlayerId
            ? [this.focusPlayerId]
            : [];
    const focused = new Set<number>();
    for (const id of focusIds) {
      const i = this.opponentIds.indexOf(id);
      if (i >= 0) focused.add(i);
    }
    if (n <= 1 || this.boardWidth <= 0 || focused.size === 0) {
      this.delimTarget = evenDelimiters(n);
      return;
    }
    const banner = COLLAPSED_OPPONENT_WIDTH_PX / this.boardWidth;
    const each = Math.max(banner, (1 - (n - focused.size) * banner) / focused.size);
    const target: number[] = [];
    let acc = 0;
    for (let i = 0; i < n - 1; i++) {
      acc += focused.has(i) ? each : banner;
      target.push(acc);
    }
    this.delimTarget = target;
  }

  private easeDelimiters(): void {
    const n = this.opponentIds.length;
    if (n <= 1) return;
    if (this.delimCurrent.length !== n - 1) this.delimCurrent = evenDelimiters(n);
    if (this.delimTarget.length !== n - 1) this.recomputeDelimTarget();
    if (this.draggingDelim === null) {
      for (let i = 0; i < n - 1; i++) {
        const d = this.delimTarget[i]! - this.delimCurrent[i]!;
        this.delimCurrent[i] =
          Math.abs(d) > DELIMITER_EASE.SNAP
            ? this.delimCurrent[i]! + d * DELIMITER_EASE.FACTOR
            : this.delimTarget[i]!;
      }
    }
    this.applyDelimiters();
    // Capsules ride the bands (setClip never re-grids), so the keep-outs must
    // be reconciled once the motion ends — ease settle and grip release both
    // land here as a moving→still edge.
    const moving = this.draggingDelim !== null || this.delimitersSettling();
    if (this.delimsWereMoving && !moving) this.refreshCapsuleBlockers();
    this.delimsWereMoving = moving;
  }

  /** Apply the current delimiters to each opponent region as a clip band, and
   *  reposition the grip handles. Bands tile the canvas, so no card ever moves —
   *  only the masks change. */
  private applyDelimiters(): void {
    this.layoutSelfBar();
    const n = this.opponentIds.length;
    const W = this.boardWidth;
    if (n <= 0 || W <= 0) return;
    this.collapseVeil.clear();
    const veilStart = COLLAPSED_OPPONENT_WIDTH_PX * 2;
    const veilColor = hexToNum(this.theme.appTheme.background);
    for (let i = 0; i < n; i++) {
      const rec = this.regions.get(this.opponentIds[i]!);
      if (!rec) continue;
      const left = Math.round((i === 0 ? 0 : this.delimCurrent[i - 1]!) * W);
      const right = Math.round((i === n - 1 ? 1 : this.delimCurrent[i]!) * W);
      const bandW = Math.max(0, right - left);
      rec.region.setClip(left, bandW);
      if (this.barsEnabled) {
        // Solid veil opacity ramps 0→1 as the band narrows from `veilStart` down
        // to its collapsed width — fully in sync with the ease, no separate tween.
        const frac = Math.max(
          0,
          Math.min(1, (veilStart - bandW) / (veilStart - COLLAPSED_OPPONENT_WIDTH_PX)),
        );
        if (frac > 0.001) {
          this.collapseVeil.rect(left, 0, bandW, this.topHeight + this.stripBandPx / 2);
          this.collapseVeil.fill({ color: veilColor, alpha: frac });
        }
        // A field clipped down to (about) its banner width → collapsed column;
        // otherwise a left-aligned bar capped at the max width.
        const column = bandW <= COLLAPSED_OPPONENT_WIDTH_PX + 4;
        // Collapsed → the panel fills the whole band and the field's full height
        // (sitting on the `collapseVeil` that occludes the cards). Expanded → a
        // left-aligned bar at the fixed max width / capsule height.
        const barW = column ? bandW : PLAYER_BAR_MAX_WIDTH_PX;
        const barH = column ? this.topHeight : PLAYER_BAR_HEIGHT_PX;
        const barX = column ? left : left + PLAYER_BAR_SIDE_MARGIN_PX;
        const barY = column ? 0 : PLAYER_BAR_TOP_MARGIN_PX;
        this.playerBars.setRect(this.opponentIds[i]!, barX, barY, barW, barH, column);
        this.playerBars.setCapsuleScale(
          this.opponentIds[i]!,
          !column && this.compactMode ? SELF_PLAYER_HUD_COMPACT_SCALE : 1,
        );
      }
    }
    this.drawDelimiterFog();
    this.layoutGripHandles();
    this.drawHoverHighlight();
  }

  setZoneTiles(byPlayer: Record<string, ZoneTileSpec[]>): void {
    for (const [id, rec] of this.regions) rec.region.setZoneTiles(byPlayer[id] ?? []);
  }

  private layoutSelfBar(): void {
    if (!this.barsEnabled || !this.localPlayerId) return;
    const zone = this.localZone();
    if (!zone) return;
    const pad = 8;
    const scale = this.compactMode ? SELF_PLAYER_HUD_COMPACT_SCALE : 1;
    const width = Math.min(Math.max(0, zone.width - pad * 2), PLAYER_BAR_MAX_WIDTH_PX);
    this.playerBars.setRect(
      this.localPlayerId,
      zone.x + pad,
      zone.y + zone.height - SELF_PLAYER_BAR_HEIGHT_PX * scale - pad,
      width,
      SELF_PLAYER_BAR_HEIGHT_PX,
      false,
    );
    this.playerBars.setCapsuleScale(this.localPlayerId, scale);
  }

  /** Set the opponent player bars (thin Pixi panels over the top of each field)
   *  and whether they're shown. Toggling on/off re-grids the opponents, since the
   *  bar reserves space at the top of the grid. */
  setPlayerBars(specs: PlayerBarSpec[], enabled: boolean): void {
    const reserveChanged = this.barsEnabled !== enabled;
    this.barsEnabled = enabled;
    this.playerBars.container.visible = enabled;
    this.playerBars.setBars(enabled ? specs : []);
    if (reserveChanged) {
      for (const rec of this.regions.values()) {
        if (rec.isLocal) continue;
        const state = rec.region.getLastState();
        if (state) rec.region.updateBattlefield(state);
      }
    }
    this.applyDelimiters();
    this.refreshCapsuleBlockers();
  }

  /** Re-grid a region when its capsule's keep-out footprint moved or resized
   *  since the last battlefield layout — capsules are positioned after regions
   *  lay out (configure order, delimiter easing), and capsule growth (badge
   *  wrap, pill counts) triggers no battlefield update on its own. */
  private refreshCapsuleBlockers(): void {
    if (!this.compactMode) return;
    for (const [id, rec] of this.regions) {
      const b = this.playerBars.getCapsuleBounds(id);
      const key = b ? [b.x, b.y, b.width, b.height].map((v) => Math.round(v / 4)).join(",") : "";
      if (this.lastCapsuleRects.get(id) === key) continue;
      this.lastCapsuleRects.set(id, key);
      const state = rec.region.getLastState();
      if (state) rec.region.updateBattlefield(state);
    }
  }

  /** Bleed a fog-of-war fade from each delimiter into its adjacent fields. The
   *  intensity tracks how far each field is from FULLY expanded (a linear ratio
   *  of its width between collapsed and max), so the fog eases smoothly in and
   *  out as a field opens/closes and vanishes entirely once a field is focused. */
  /** The divider + fog colour: a gently darkened canvas background. The field
   *  felt is canvas-background-coloured, so a same-colour fog is invisible
   *  against it; a mild darken (`DIVIDER.darken`) is the minimum distinct shade
   *  that still reads as a seam without going near-black. */
  private dividerColor(): string {
    return darken(this.theme.gameTheme.canvas.background, DIVIDER.darken);
  }

  private drawDelimiterFog(): void {
    const g = this.fogGfx;
    g.clear();
    const n = this.opponentIds.length;
    const W = this.boardWidth;
    if (n <= 1 || W <= 0) return;
    // Reach the middle horizontal line; the phase strip (drawn on top) hides the
    // end so it tucks under the phase bar.
    const h = this.topHeight + this.stripBandPx / 2;
    const C = COLLAPSED_OPPONENT_WIDTH_PX;
    const leftEdge = (i: number) => Math.round((i === 0 ? 0 : this.delimCurrent[i - 1]!) * W);
    const rightEdge = (i: number) => Math.round((i === n - 1 ? 1 : this.delimCurrent[i]!) * W);
    const widthOf = (i: number) => rightEdge(i) - leftEdge(i);

    // 1 when the field is collapsed to a banner, 0 when fully expanded.
    const span = W - n * C;
    const fogOf = (i: number) =>
      span <= 0 ? 0 : Math.min(1, Math.max(0, 1 - (widthOf(i) - C) / span));

    const grad = this.fogGradients();
    // Both gradients hit full DIVIDER.alpha at the divider, so the two sides meet
    // there at the same darkness — no seam — and match the bar. Intensity scales
    // only the leak width, never the peak.
    for (let d = 0; d < n - 1; d++) {
      const x = Math.round(this.delimCurrent[d]! * W);
      const wL = DIVIDER.fadeWidthPx * fogOf(d);
      const wR = DIVIDER.fadeWidthPx * fogOf(d + 1);
      if (wR >= 1) g.rect(x, 0, wR, h).fill(grad.right);
      if (wL >= 1) g.rect(x - wL, 0, wL, h).fill(grad.left);
    }
  }

  /** Horizontal gradients (divider colour, full `DIVIDER.alpha` at the divider →
   *  clear into the field), built once and reused. The `local` texture space maps
   *  each gradient to its own rect, so one pair works at any position/width. */
  private fogGradients(): { left: FillGradient; right: FillGradient } {
    if (!this.fogGradRight || !this.fogGradLeft) {
      const color = this.dividerColor();
      const solid = withAlpha(color, DIVIDER.alpha);
      const clear = withAlpha(color, 0);
      const linear = (stops: { offset: number; color: string }[]) =>
        new FillGradient({
          type: "linear",
          start: { x: 0, y: 0 },
          end: { x: 1, y: 0 },
          textureSpace: "local",
          colorStops: stops,
        });
      this.fogGradRight = linear([
        { offset: 0, color: solid },
        { offset: 1, color: clear },
      ]);
      this.fogGradLeft = linear([
        { offset: 0, color: clear },
        { offset: 1, color: solid },
      ]);
    }
    return { left: this.fogGradLeft, right: this.fogGradRight };
  }

  private rebuildGripHandles(): void {
    for (const h of this.gripHandles) {
      this.gripLayer.removeChild(h);
      h.destroy();
    }
    this.gripHandles = [];
    const handleCount = Math.max(0, this.opponentIds.length - 1);
    for (let i = 0; i < handleCount; i++) {
      const handle = new Graphics();
      handle.eventMode = "static";
      handle.cursor = "col-resize";
      handle.on("pointerdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        this.draggingDelim = i;
        this.activeGesturePointerId = e.pointerId;
      });
      this.gripLayer.addChild(handle);
      this.gripHandles.push(handle);
    }
  }

  private layoutGripHandles(): void {
    const W = this.boardWidth;
    // Reach the middle horizontal line and tuck under the phase bar.
    const h = this.topHeight + this.stripBandPx / 2;
    const color = hexToNum(this.dividerColor());
    for (let i = 0; i < this.gripHandles.length; i++) {
      const handle = this.gripHandles[i]!;
      handle.position.set((this.delimCurrent[i] ?? (i + 1) / (this.gripHandles.length + 1)) * W, 0);
      handle.hitArea = new Rectangle(-GRIP_HIT_WIDTH_PX / 2, 0, GRIP_HIT_WIDTH_PX, h);
      handle.clear();
      handle.roundRect(-DIVIDER.barWidthPx / 2, 0, DIVIDER.barWidthPx, h, DIVIDER.barWidthPx / 2);
      handle.fill({ color, alpha: DIVIDER.alpha });
    }
  }

  private dragDelimiterTo(localX: number): void {
    const n = this.opponentIds.length;
    const W = this.boardWidth;
    const i = this.draggingDelim;
    if (i === null || n <= 1 || W <= 0) return;
    const minGap = COLLAPSED_OPPONENT_WIDTH_PX / W;
    const lo = (i === 0 ? 0 : this.delimCurrent[i - 1]!) + minGap;
    const hi = (i === n - 2 ? 1 : this.delimCurrent[i + 1]!) - minGap;
    this.delimCurrent[i] = Math.max(lo, Math.min(hi, localX / W));
    // A manual drag overrides auto-focus until the next turn change.
    this.delimTarget = [...this.delimCurrent];
    this.applyDelimiters();
  }

  private delimitersSettling(): boolean {
    for (let i = 0; i < this.delimCurrent.length; i++) {
      const target = this.delimTarget[i] ?? this.delimCurrent[i]!;
      if (Math.abs(target - this.delimCurrent[i]!) > DELIMITER_EASE.SNAP) return true;
    }
    return false;
  }

  private isOverStack(x: number, y: number): boolean {
    const b = this.stackProvider?.getBounds();
    return !!b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
  }

  private beginPinch(): void {
    const pts = [...this.pinchPointers.values()];
    const a = pts[0]!;
    const b = pts[1]!;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist <= 0) return;
    for (const id of this.pinchPointers.keys()) this.tapSuppressedPointers.add(id);
    this.abortActiveGesture();
    const scale = this.root.scale.x;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinchStart = {
      dist,
      scale,
      world: {
        x: (mid.x - this.root.position.x) / scale,
        y: (mid.y - this.root.position.y) / scale,
      },
    };
  }

  private updatePinch(): void {
    if (!this.pinchStart) return;
    const pts = [...this.pinchPointers.values()];
    const a = pts[0]!;
    const b = pts[1]!;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const s = Math.min(
      BOARD_ZOOM_MAX,
      Math.max(1, this.pinchStart.scale * (dist / this.pinchStart.dist)),
    );
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.root.scale.set(s);
    this.root.position.set(
      Math.min(0, Math.max(this.canvasW * (1 - s), mid.x - this.pinchStart.world.x * s)),
      Math.min(0, Math.max(this.canvasH * (1 - s), mid.y - this.pinchStart.world.y * s)),
    );
  }

  private endPinch(): void {
    if (!this.pinchStart) return;
    this.pinchStart = null;
    if (this.root.scale.x < BOARD_ZOOM_SNAP_BACK) this.resetBoardZoom();
  }

  private resetBoardZoom(): void {
    this.pinchStart = null;
    this.root.scale.set(1);
    this.root.position.set(0, 0);
  }

  private abortActiveGesture(): void {
    const local = this.localRegion();
    if (this.dragHandler.isDragging) {
      this.dragHandler.end();
      local?.hideGridSkeleton();
    }
    if (this.selection?.isMarqueeActive() && local) {
      this.selection.endMarquee(local.snapshotCurrentPositions());
    }
    if (this.unassignDrag) {
      const ud = this.unassignDrag;
      this.unassignDrag = null;
      const st = ud.region.getLastState();
      if (st) ud.region.updateBattlefield(st);
    }
    local?.cancelZoneTileDrag();
    this.draggingDelim = null;
    this.setBlockDragId(null);
    this.setAttackDragId(null);
    this.attackDragCandidate = null;
    this.activeGesturePointerId = null;
    this.longPress.reset();
    const state = local?.getLastState();
    if (local && state) local.updateBattlefield(state);
  }

  private updateHoveredOpponent(canvasX: number, canvasY: number): void {
    if (this.pinchStart) return;
    const local = this.root.toLocal(new Point(canvasX, canvasY));
    const localX = local.x;
    const localY = local.y;
    const n = this.opponentIds.length;
    const W = this.boardWidth;
    let hovered: string | null = null;
    if (
      n > 0 &&
      W > 0 &&
      localY >= 0 &&
      localY <= this.topHeight &&
      !this.isOverStack(canvasX, canvasY)
    ) {
      for (let i = 0; i < n; i++) {
        const left = (i === 0 ? 0 : this.delimCurrent[i - 1]!) * W;
        const right = (i === n - 1 ? 1 : this.delimCurrent[i]!) * W;
        if (localX >= left && localX < right) {
          hovered = this.opponentIds[i]!;
          break;
        }
      }
    }
    if (hovered === this.hoveredOpponentId) return;
    this.hoveredOpponentId = hovered;
    this.drawHoverHighlight();
    // Open the hovered field (or fall back to the turn focus on leave). A manual
    // grip drag owns the delimiters, so don't retarget mid-drag.
    if (this.draggingDelim === null) this.recomputeDelimTarget();
    this.callbacks.onHoverOpponent?.(hovered);
  }

  private drawHoverHighlight(): void {
    // Hover still drives focus, but no coloured field tint is drawn.
    this.highlightGfx.clear();
  }

  private setupLocalControllers(region: BoardRegion): void {
    this.hand = new HandController(this.makeHandHost(), this.root);
    this.hand.setCompact(this.compactMode);
    this.selection = new SelectionController(this.makeSelectionHost(region), this.root);
    this.overlay = new BattlefieldOverlay(this.makeOverlayHost(region));
    region.enableFeltMarquee((e) => this.onFeltDown(e));
  }

  private onFeltDown(e: FederatedPointerEvent): void {
    if (this.destroyed) return;
    const selection = this.selection;
    if (!selection) return;
    if (this.declareBlockers) return;
    const pos = this.root.toLocal(e.global);
    // Don't clear on press — endMarquee handles it on release, so a stray press
    // doesn't wipe the current selection before any movement.
    selection.startMarquee(pos.x, pos.y, e.shiftKey);
    this.activeGesturePointerId = e.pointerId;
  }

  private positionPhaseStrip(layout: BoardLayout): void {
    this.lastLayout = layout;
    this.stripBandPx = layout.stripBandPx;
    this.phaseStrip.container.x = layout.self.x;
    this.phaseStrip.container.y = layout.dividerY - this.stripBandPx / 2;
    this.phaseStrip.resize(layout.self.width, this.stripBandPx);
    this.drawStripBackground(layout);
  }

  private drawStripBackground(layout: BoardLayout): void {
    const g = this.stripBackgroundGfx;
    g.clear();
    const y = layout.dividerY - this.stripBandPx / 2;
    g.roundRect(layout.self.x, y, layout.self.width, this.stripBandPx, TABLE_RADIUS);
    g.fill({ color: hexToNum(this.theme.gameTheme.canvas.background), alpha: BG_ALPHA_IDLE });
  }

  private localRegion(): BoardRegion | null {
    return this.localPlayerId ? (this.regions.get(this.localPlayerId)?.region ?? null) : null;
  }

  private localZone(): PlayZoneRect | null {
    return this.localPlayerId ? (this.regions.get(this.localPlayerId)?.zone ?? null) : null;
  }

  updateBattlefield(playerId: string, cards: CardDto[]): void {
    this.regions.get(playerId)?.region.updateBattlefield({ cards } as BattlefieldState);
  }

  updateRegionState(playerId: string, state: BattlefieldState): void {
    this.regions.get(playerId)?.region.updateBattlefield(state);
    this.refreshPhaseStripDim();
  }

  pruneCardPositions(liveIds: ReadonlySet<string>): void {
    for (const id of this.lastCardPositions.keys()) {
      if (!liveIds.has(id)) this.lastCardPositions.delete(id);
    }
  }

  private refreshPhaseStripDim(): void {
    let active = false;
    for (const rec of this.regions.values()) {
      if (rec.region.getLastState()?.cards.some((c) => c.isAttacking)) {
        active = true;
        break;
      }
    }
    this.phaseStripAlphaTarget =
      active && !this.phaseStrip.isCompactExpanded() ? PHASE_STRIP_COMBAT_ALPHA : 1;
    for (const rec of this.regions.values()) rec.region.setCombatDim(active);
  }

  updateHand(state: HandState): void {
    this.hand?.updateHand(state);
  }

  holdHandHover(): void {
    this.hand?.holdHover();
  }

  releaseHandHover(): void {
    this.hand?.releaseHover();
  }

  setHandPreviewFace(face: 0 | 1): void {
    this.hand?.setHoveredPreviewFace(face);
  }

  setHandFlippedHorizontal(flipped: boolean): void {
    this.hand?.setHoveredHorizontalFlipped(flipped);
  }

  setHandScale(scale: number): void {
    this.hand?.setScale(scale);
    this.hand?.relayout();
  }

  setHandInsets(left: number, right: number): void {
    if (this.handInsetLeft === left && this.handInsetRight === right) return;
    this.handInsetLeft = left;
    this.handInsetRight = right;
    this.hand?.relayout();
  }

  setCombatStaging(playerId: string, staging: SceneCombatStaging | null): void {
    this.regions.get(playerId)?.region.setCombatStaging(staging);
  }

  applyCombatBlocks(blocks: { blockerId: string; attackerId: string }[]): void {
    if (this.destroyed) return;
    const canvasLeft = this.app.canvas.getBoundingClientRect().left;
    const regionOf = (cardId: string): BoardRegion | null => {
      for (const rec of this.regions.values()) {
        if (rec.region.getCardPosition(cardId)) return rec.region;
      }
      return null;
    };

    const byAttacker = new Map<string, string[]>();
    for (const { blockerId, attackerId } of blocks) {
      const list = byAttacker.get(attackerId);
      if (list) list.push(blockerId);
      else byAttacker.set(attackerId, [blockerId]);
    }

    interface Acc {
      attackerIds: Set<string>;
      blockers: StagedBlocker[];
      blockerIds: Set<string>;
    }
    const acc = new Map<BoardRegion, Acc>();
    const accFor = (region: BoardRegion): Acc => {
      let a = acc.get(region);
      if (!a) {
        a = { attackerIds: new Set(), blockers: [], blockerIds: new Set() };
        acc.set(region, a);
      }
      return a;
    };

    for (const [attackerId, blockerIds] of byAttacker) {
      const attackerRegion = regionOf(attackerId);
      const pos = attackerRegion?.getCardPosition(attackerId);
      if (!attackerRegion || !pos) continue;
      const laneScreenX = pos.x + canvasLeft;
      accFor(attackerRegion).attackerIds.add(attackerId);
      blockerIds.forEach((blockerId, i) => {
        const blockerRegion = regionOf(blockerId);
        if (!blockerRegion) return;
        const a = accFor(blockerRegion);
        a.blockers.push({
          id: blockerId,
          laneScreenX,
          attackerY: pos.y,
          indexInLane: i,
          laneCount: blockerIds.length,
        });
        a.blockerIds.add(blockerId);
      });
    }

    for (const rec of this.regions.values()) {
      const a = acc.get(rec.region);
      const staged = !!a && (a.attackerIds.size > 0 || a.blockers.length > 0);
      rec.region.setCombatStaging(
        staged
          ? { attackerIds: a!.attackerIds, blockers: a!.blockers, blockerIds: a!.blockerIds }
          : null,
      );
      rec.region.container.zIndex = staged ? Z_STAGED_REGION : rec.isLocal ? 100 : 50;
    }
    this.refreshPhaseStripDim();
  }

  setArrowSpecs(specs: ArrowSpec[]): void {
    this.arrowSpecs = specs;
  }

  setCastingArrow(arrow: { sourceCardId: string; hostile: boolean } | null): void {
    this.castingArrow = arrow;
  }

  setDeclareBlockers(active: boolean): void {
    this.declareBlockers = active;
    if (!active) this.setBlockDragId(null);
  }

  private setBlockDragId(id: string | null): void {
    if (this.blockDragBlockerId === id) return;
    this.blockDragBlockerId = id;
    this.callbacks.onBlockDragChange?.(id);
  }

  setDeclareAttackers(
    active: boolean,
    attackTargets: AttackTargetDto[],
    attackerOptions: { attackerId: string; validTargetIds: string[] }[],
  ): void {
    this.declareAttackers = active;
    this.attackTargets = attackTargets;
    this.attackerOptions = attackerOptions;
    if (!active) {
      this.setAttackDragId(null);
      this.unassignDrag = null;
    }
  }

  private setAttackDragId(id: string | null): void {
    if (this.attackDragAttackerId === id) return;
    this.attackDragAttackerId = id;
    if (id === null) {
      this.attackDragTargetId = null;
      this.updateAttackTargetRing(null);
    }
    this.callbacks.onAttackDragChange?.(id);
  }

  private updateAttackTargetRing(cardId: string | null): void {
    for (const rec of this.regions.values()) rec.region.setAttackTargetRing(cardId);
  }

  /** Resolve a scene-space point (root-local, as `getCardPosition` returns) to a
   *  legal defender for `attackerId`: a planeswalker/battle card directly under
   *  the pointer wins; otherwise the opponent whose field band the pointer is
   *  over (proximity → the player). */
  private resolveAttackTargetAt(gx: number, gy: number, attackerId: string): string | null {
    const valid = this.attackerOptions.find((a) => a.attackerId === attackerId)?.validTargetIds;
    if (!valid || valid.length === 0) return null;
    const validSet = new Set(valid);
    // Generous pad around each planeswalker/battle so dragging *near* one targets
    // it; when several enlarged hit-zones overlap, the nearest centre wins.
    let best: { id: string; dist: number } | null = null;
    for (const t of this.attackTargets) {
      if (t.kind === "player" || !validSet.has(t.id)) continue;
      for (const rec of this.regions.values()) {
        if (rec.isLocal) continue;
        const center = rec.region.getCardPosition(t.id);
        if (!center) continue;
        if (!rec.region.containsPointInCard(t.id, gx, gy, ATTACK_TARGET_HIT_PAD)) continue;
        const dist = (gx - center.x) ** 2 + (gy - center.y) ** 2;
        if (!best || dist < best.dist) best = { id: t.id, dist };
      }
    }
    if (best) return best.id;
    const oppId = this.hoveredOpponentId;
    if (
      oppId &&
      validSet.has(oppId) &&
      this.attackTargets.some((t) => t.id === oppId && t.kind === "player")
    ) {
      return oppId;
    }
    return null;
  }

  setPhaseStripState(state: PhaseStripState): void {
    this.phaseStrip.update(state);
  }

  setPhaseStripCallbacks(cb: PhaseStripCallbacks): void {
    this.phaseStrip.setCallbacks(cb);
  }

  setCompactMode(compact: boolean): void {
    if (this.compactMode === compact) return;
    this.compactMode = compact;
    this.phaseStrip.setCompact(compact);
    this.hand?.setCompact(compact);
    this.playerBars.setCompact(compact);
    this.applyDelimiters();
    for (const rec of this.regions.values()) rec.region.setCompactZones(compact);
  }

  setStackAnchorProvider(provider: StackAnchorProvider | null): void {
    this.stackProvider = provider;
  }

  setPlayerBlockers(blockers: Map<string, BlockingRect[]>): void {
    this.playerBlockers = blockers;
    for (const rec of this.regions.values()) {
      const state = rec.region.getLastState();
      if (state) rec.region.updateBattlefield(state);
    }
  }

  setDropActive(active: boolean): void {
    this.dropActive = active;
    this.localRegion()?.setDropActive(active);
    this.hand?.setDropActive(active);
  }

  setAutoSort(value: boolean): void {
    this.autoSort = value;
    for (const rec of this.regions.values()) rec.region.setAutoSort(value);
  }

  previewEtb(): void {
    for (const rec of this.regions.values()) rec.region.previewEtb();
  }

  setPendingDropSlot(slot: { col: number; row: number } | null): void {
    this.localRegion()?.setPendingDropSlot(slot);
  }

  setCardStyle(style: BattlefieldCardStyle): void {
    if (this.destroyed) return;
    setCardSpriteStyle(style);
    for (const rec of this.regions.values()) rec.region.restyleCards();
  }

  setHoverDebug(on: boolean): void {
    if (this.destroyed) return;
    setCardSpriteHoverDebug(on);
    for (const rec of this.regions.values()) rec.region.redrawHoverDebug();
    this.hand?.setHoverDebug(on);
  }

  setGridSkeletonDebug(on: boolean): void {
    if (this.destroyed) return;
    this.gridSkeletonDebug = on;
    for (const rec of this.regions.values()) rec.region.setSkeletonDebug(on);
  }

  setAttackRowDebug(on: boolean): void {
    if (this.destroyed) return;
    this.attackRowDebug = on;
    for (const rec of this.regions.values()) rec.region.setAttackRowDebug(on);
  }

  setTheme(theme: Theme): void {
    if (this.destroyed) return;
    this.theme = theme;
    this.fogGradRight = this.fogGradLeft = null;
    setCardSpriteTheme(theme);
    this.phaseStrip.setTheme(theme);
    this.playerBars.setTheme(theme);
    this.drawBaseBg();
    if (this.lastLayout) {
      this.drawStripBackground(this.lastLayout);
    }
    for (const rec of this.regions.values()) rec.region.redrawTheme();
    this.applyDelimiters(); // repaint the collapse veil in the new theme colour
  }

  resize(width: number, height: number): void {
    if (this.destroyed) return;
    this.app.renderer.resize(width, height);
    this.dragHandler.setContainerSize(width, height);
    this.playerBars.setViewport(width, height);
    this.canvasW = width;
    this.canvasH = height;
    this.pinchPointers.clear();
    this.resetBoardZoom();
    this.drawBaseBg();
  }

  private drawBaseBg(): void {
    this.baseBg.clear();
    if (this.canvasW <= 0 || this.canvasH <= 0) return;
    this.baseBg.rect(0, 0, this.canvasW, this.canvasH);
    this.baseBg.fill({ color: hexToNum(this.theme.appTheme.background), alpha: 1 });
  }

  private makeRegionHost(playerId: string, isLocal: boolean): RegionHost {
    return {
      getTheme: () => this.theme,
      collectBlockers: () => [
        ...(this.playerBlockers.get(playerId) ?? []),
        ...(isLocal ? this.localBlockers() : []),
        ...(this.compactMode ? this.capsuleBlockers(playerId) : []),
      ],
      getEntrySeed: (cardId) => this.entrySeedFor(playerId, isLocal, cardId),
      getCombatGuestLayer: () => this.combatGuestLayer,
      recordCardExit: (cardId, seed) => this.lastCardPositions.set(cardId, seed),
      isSelected: (cardId) => (isLocal ? (this.selection?.has(cardId) ?? false) : false),
      rebuildOverlay: (entry, state) => {
        if (isLocal) this.overlay?.rebuild(entry, state);
      },
      wireSprite: (sprite) => this.wireSprite(sprite, playerId, isLocal),
      screenXToLocalX: (screenX) => screenX - this.app.canvas.getBoundingClientRect().left,
      getHandReserveBottom: () =>
        isLocal
          ? this.handReserveBottom() *
            (this.compactMode ? HAND_RESERVE_TRIM_COMPACT : HAND_RESERVE_TRIM)
          : 0,
      // The opponent HUD is a keep-out blocker (see BoardRegion.collectLocalBlockers)
      // rather than a full-width top reserve, so the grid uses the whole height.
      getTopReserve: () => 0,
      spawnFloatingText: (x, y, content, color) => this.spawnFloatingText(x, y, content, color),
      previewCard: (card, bounds) => {
        if (!card) {
          this.callbacks.onHoverCard?.(null);
          return;
        }
        this.callbacks.onHoverCard?.(card, bounds && this.toViewportBounds(bounds), {
          useAnchor: true,
        });
      },
      isPointerTapSuppressed: (pointerId) => this.tapSuppressedPointers.has(pointerId),
      isDestroyed: () => this.destroyed,
    };
  }

  spawnFloatingText(canvasX: number, canvasY: number, content: string, color: number): void {
    if (this.destroyed) return;
    const text = new Text({
      text: content,
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: FLOATER_FONT_SIZE,
        fontWeight: "900",
        fill: color,
        stroke: { color: 0x000000, width: 4 },
      },
    });
    text.anchor.set(0.5);
    text.position.set(canvasX, canvasY);
    this.floaterLayer.addChild(text);
    this.floaters.push({ text, age: 0 });
  }

  private animateFloaters(): void {
    if (this.floaters.length === 0) return;
    const survivors: { text: Text; age: number }[] = [];
    for (const f of this.floaters) {
      f.age += 1;
      f.text.y -= FLOATER_RISE_PER_FRAME;
      const t = f.age / FLOATER_LIFETIME_FRAMES;
      f.text.alpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) / 0.5);
      if (f.age >= FLOATER_LIFETIME_FRAMES) {
        this.floaterLayer.removeChild(f.text);
        f.text.destroy();
      } else {
        survivors.push(f);
      }
    }
    this.floaters = survivors;
  }

  private handReserveBottom(): number {
    const rect = this.hand?.getBlockerRect();
    const zone = this.localZone();
    if (!rect || !zone) return 0;
    return Math.max(0, zone.y + zone.height - rect.y);
  }

  private handReserveCb: ((px: number) => void) | null = null;
  private lastEmittedHandReserve = -1;
  setOnHandReserveChange(cb: ((px: number) => void) | null): void {
    this.handReserveCb = cb;
  }

  /** The hand blocker is root-local; `collectBlockers` rects are canvas-space
   *  (regions convert back through the zoomed root transform). */
  private localBlockers(): BlockingRect[] {
    const handRect = this.hand?.getBlockerRect();
    if (!handRect) return [];
    const tl = this.root.toGlobal(RECT_SCRATCH_A.set(handRect.x, handRect.y), RECT_SCRATCH_A);
    const br = this.root.toGlobal(
      RECT_SCRATCH_B.set(handRect.x + handRect.width, handRect.y + handRect.height),
      RECT_SCRATCH_B,
    );
    return [{ x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y }];
  }

  private capsuleBlockers(playerId: string): BlockingRect[] {
    const b = this.playerBars.getCapsuleBounds(playerId);
    return b ? [b] : [];
  }

  private entrySeedFor(
    playerId: string,
    isLocal: boolean,
    cardId: string,
  ): { x: number; y: number; scaleX: number; scaleY: number; glide?: boolean } {
    if (isLocal && this.hand) {
      const live = this.hand.getLiveSpriteTransform(cardId);
      if (live) return live;
    }
    const remembered = this.lastCardPositions.get(cardId);
    if (remembered) return { ...remembered, glide: true };
    const stack = this.stackCardSeeds.get(cardId);
    if (stack) return { x: stack.x, y: stack.y, scaleX: stack.scale, scaleY: stack.scale };
    if (isLocal && this.hand) {
      const origin = this.hand.getOriginSeed();
      return { x: origin.x, y: origin.y, scaleX: origin.scale, scaleY: origin.scale };
    }
    const zone = this.regions.get(playerId)?.zone;
    const scale = this.cardScale;
    if (!zone) return { x: 0, y: 0, scaleX: scale, scaleY: scale };
    return {
      x: zone.x + zone.width / 2,
      y: zone.y + (CARD_H * scale) / 2,
      scaleX: scale,
      scaleY: scale,
    };
  }

  private makeHandHost(): HandHost {
    return {
      getPlayZone: () => {
        const zone = this.localZone();
        if (!zone) return { x: 0, y: 0, width: 0, height: 0 };
        const left = this.handInsetLeft;
        const right = this.handInsetRight;
        if (left <= 0 && right <= 0) return zone;
        return {
          x: zone.x + left,
          y: zone.y,
          width: Math.max(0, zone.width - left - right),
          height: zone.height,
        };
      },
      getCallbacks: () => this.callbacks,
      getTheme: () => this.theme,
      isMirrored: () => false,
      showsHand: () => true,
      isDestroyed: () => this.destroyed,
      setHandExclusion: (rect) => {
        this.dragHandler.setHandExclusion(rect);
        this.localRegion()?.redrawBackground();
      },
    };
  }

  private makeSelectionHost(region: BoardRegion): SelectionHost {
    return {
      getPlayZone: () => this.localZone() ?? { x: 0, y: 0, width: 0, height: 0 },
      getTheme: () => this.theme,
      getEntries: () => region.getEntries(),
      applyRing: (sprite) => region.applyBaseRing(sprite),
      canRefreshRings: () => region.hasLastState(),
      isCompact: () => this.compactMode,
    };
  }

  private makeOverlayHost(region: BoardRegion): OverlayHost {
    return {
      getTheme: () => this.theme,
      getCallbacks: () => this.callbacks,
      getContainer: () => region.container,
      getSelectedCardIds: () => this.selection?.getSelected() ?? new Set<string>(),
      getLastState: () => region.getLastState(),
      getEntries: () => region.getEntries(),
      isJustDragged: (id) => this.dragHandler.justDraggedCardIds.has(id),
      startCardDrag: (sprite, e) => this.onBattlefieldCardDown(sprite, e),
      cancelHoverClear: () => this.cancelHoverClear(),
      setCardHovered: (sprite) => this.setBattlefieldCardHovered(region, sprite),
      scheduleHoverClear: (id) => this.scheduleHoverClear(id),
      getCardScale: () => region.getCardScale(),
      isCompact: () => this.compactMode,
    };
  }

  private wireSprite(sprite: CardSprite, playerId: string, isLocal: boolean): void {
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    const region = this.regions.get(playerId)?.region;
    // A guest attacker sitting in the local player's combat row (an opponent's
    // creature, controllerId ≠ us) must keep the attacker wiring — tap/drop to
    // block — not the local drag wiring, or it can't be blocked.
    if (isLocal && sprite.card.controllerId === playerId) {
      sprite.on("pointerdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        if (region) {
          this.longPress.start(e, sprite.card.id, () => this.fireLongPressPreview(region, sprite));
        }
        this.onBattlefieldCardDown(sprite, e);
      });
      sprite.on("pointertap", (e: FederatedPointerEvent) => {
        if (this.tapSuppressedPointers.has(e.pointerId)) return;
        if (this.dragHandler.justDraggedCardIds.has(sprite.card.id)) return;
        if (this.longPress.consumeTap(sprite.card.id)) return;
        this.overlay?.handleCardTap(sprite.card);
      });
    } else {
      sprite.on("pointerdown", (e: FederatedPointerEvent) => {
        if (region) {
          this.longPress.start(e, sprite.card.id, () => this.fireLongPressPreview(region, sprite));
        }
        // Grab our own declared attacker (staged in this opponent's band) to
        // drag it back and un-declare it.
        if (this.declareAttackers && sprite.card.controllerId === this.localPlayerId && region) {
          e.stopPropagation();
          this.callbacks.onDismissHoverPreview?.();
          this.unassignDrag = { cardId: sprite.card.id, region, overOwn: false };
          this.activeGesturePointerId = e.pointerId;
        }
      });
      sprite.on("pointertap", (e: FederatedPointerEvent) => {
        if (this.tapSuppressedPointers.has(e.pointerId)) return;
        if (this.longPress.consumeTap(sprite.card.id)) return;
        if (isAttackerTap(region?.getLastState() ?? null, sprite.card.id)) {
          this.callbacks.onAttackerClick?.(sprite.card);
        } else {
          this.callbacks.onClickCard?.(sprite.card);
        }
      });
      sprite.on("pointerup", () => {
        if (
          this.blockDragBlockerId &&
          isAttackerTap(region?.getLastState() ?? null, sprite.card.id)
        ) {
          this.callbacks.onAssignBlock?.(this.blockDragBlockerId, sprite.card.id);
          this.setBlockDragId(null);
        }
      });
    }
    sprite.on("pointerenter", () => {
      if (region) this.setBattlefieldCardHovered(region, sprite);
    });
    sprite.on("pointerleave", () => this.scheduleHoverClear(sprite.card.id));
  }

  private isCollapsedOpponentBand(playerId: string): boolean {
    const n = this.opponentIds.length;
    const i = this.opponentIds.indexOf(playerId);
    const W = this.boardWidth;
    if (i < 0 || n <= 1 || W <= 0) return false;
    const left = Math.round((i === 0 ? 0 : this.delimCurrent[i - 1]!) * W);
    const right = Math.round((i === n - 1 ? 1 : this.delimCurrent[i]!) * W);
    return right - left <= COLLAPSED_OPPONENT_WIDTH_PX + 4;
  }

  private toViewportBounds(bounds: { x: number; y: number; width: number; height: number }): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const canvasRect = this.app.canvas.getBoundingClientRect();
    return {
      x: bounds.x + canvasRect.left,
      y: bounds.y + canvasRect.top,
      width: bounds.width,
      height: bounds.height,
    };
  }

  private fireLongPressPreview(region: BoardRegion, sprite: CardSprite): void {
    if (this.callbacks.onLongPressCard) {
      this.callbacks.onLongPressCard(sprite.card, this.toViewportBounds(sprite.getBounds()));
      return;
    }
    this.setBattlefieldCardHovered(region, sprite, true);
  }

  private setBattlefieldCardHovered(region: BoardRegion, sprite: CardSprite, force = false): void {
    if (this.hand?.hasActiveHover()) return;
    this.cancelHoverClear();
    if (!force && this.hoveredCardId === sprite.card.id) return;
    const prevRegion = this.hoveredRegionRef;
    if (prevRegion && prevRegion !== region) prevRegion.setHoveredCard(null);
    this.hoveredRegionRef = region;
    this.hoveredCardId = sprite.card.id;
    region.setHoveredCard(sprite.card.id);

    this.callbacks.onHoverCard?.(sprite.card, this.toViewportBounds(sprite.getBounds()), {
      useAnchor: true,
    });
  }

  private scheduleHoverClear(cardId: string): void {
    if (this.hoveredCardId !== cardId) return;
    this.cancelHoverClear();
    this.hoverClearTimer = window.setTimeout(() => {
      this.hoverClearTimer = null;
      if (this.destroyed) return;
      if (this.hoveredCardId !== cardId) return;
      this.hoveredRegionRef?.setHoveredCard(null);
      this.hoveredRegionRef = null;
      this.hoveredCardId = null;
      this.callbacks.onHoverCard?.(null);
    }, BATTLEFIELD_HOVER_HOLD_MS);
  }

  private cancelHoverClear(): void {
    if (this.hoverClearTimer !== null) {
      window.clearTimeout(this.hoverClearTimer);
      this.hoverClearTimer = null;
    }
  }

  private onBattlefieldCardDown(sprite: CardSprite, e: FederatedPointerEvent): void {
    if (this.destroyed) return;
    if (this.pinchStart) return;
    const local = this.localRegion();
    const selection = this.selection;
    if (!local || !selection) return;
    if (this.declareBlockers && local.getLastState()?.selectableCardIds?.includes(sprite.card.id)) {
      this.setBlockDragId(sprite.card.id);
      this.activeGesturePointerId = e.pointerId;
      this.callbacks.onHoverCard?.(null);
      this.callbacks.onDismissHoverPreview?.();
      return;
    }
    this.callbacks.onHoverCard?.(null);
    const pos = this.root.toLocal(e.global);
    selection.setSelected(
      this.dragHandler.start(
        sprite.card.id,
        pos.x,
        pos.y,
        selection.getSelected(),
        local.snapshotCurrentPositions(),
        e.shiftKey,
      ),
    );
    this.activeGesturePointerId = e.pointerId;
    selection.refresh();
    this.attackDragCandidate =
      this.declareAttackers && this.attackerOptions.some((a) => a.attackerId === sprite.card.id)
        ? sprite.card.id
        : null;
  }

  private onGlobalMove(e: FederatedPointerEvent): void {
    if (this.destroyed) return;
    if (this.pinchStart) return;
    if (this.activeGesturePointerId !== null && e.pointerId !== this.activeGesturePointerId) {
      return;
    }
    this.longPress.move(e.global.x, e.global.y);
    const pos = this.root.toLocal(e.global);
    this.updateHoveredOpponent(e.global.x, e.global.y);
    if (this.unassignDrag) {
      const ud = this.unassignDrag;
      const entry = ud.region.getEntries().get(ud.cardId);
      if (entry) {
        entry.targetX = pos.x;
        entry.targetY = pos.y;
        entry.sprite.x = pos.x;
        entry.sprite.y = pos.y;
      }
      // Only the self field counts as "own" — exclude the phase-strip band above
      // it, or releasing over the strip would silently un-declare the attacker.
      ud.overOwn = pos.y >= (this.localZone()?.y ?? this.topHeight);
      return;
    }
    if (this.draggingDelim !== null) {
      this.dragDelimiterTo(pos.x);
      return;
    }
    const local = this.localRegion();
    const selection = this.selection;
    const hand = this.hand;
    if (!local || !selection || !hand) return;

    if (selection.isMarqueeActive()) {
      selection.moveMarquee(pos.x, pos.y);
      return;
    }

    const dragging = this.dragHandler.draggingCardIds.size > 0 || hand.isDraggingFromHand();
    if (!dragging) {
      hand.updateHoverAt(pos.x, pos.y);
    } else if (hand.hasActiveHover()) {
      hand.resetHover();
    }

    const newPositions = this.dragHandler.move(pos.x, pos.y);
    if (!newPositions) return;
    this.callbacks.onDismissHoverPreview?.();
    const primaryId = this.dragHandler.primaryDraggingCardId;
    let primaryPos: ScreenPos | null = null;
    const draggingIds = this.dragHandler.draggingCardIds;
    const entries = local.getEntries();
    for (const [id, p] of newPositions) {
      const entry = entries.get(id);
      if (!entry) continue;
      entry.targetX = p.x;
      entry.targetY = p.y;
      entry.sprite.x = p.x;
      entry.sprite.y = p.y;
      if (entry.overlay?.visible) {
        entry.overlay.x = p.x;
        entry.overlay.y = p.y;
      }
      if (id === primaryId || (!primaryPos && !primaryId)) primaryPos = p;
      local.followAttachmentsDuringDrag(id, p);
    }

    if (this.attackDragCandidate && !this.attackDragAttackerId) {
      this.setAttackDragId(this.attackDragCandidate);
    }
    if (this.attackDragAttackerId) {
      this.attackDragTargetId = this.resolveAttackTargetAt(pos.x, pos.y, this.attackDragAttackerId);
      this.updateAttackTargetRing(this.attackDragTargetId);
      this.hoveredCell = null;
      this.stackTargetId = null;
      local.hideGridSkeleton();
      return;
    }

    const grid = local.getGridInfo();
    if (primaryPos && grid) {
      this.hoveredCell = cellFromPoint(grid, primaryPos.x, primaryPos.y);
      this.stackTargetId = this.hoveredCell
        ? local.findStackTargetAt(this.hoveredCell, draggingIds)
        : null;
    } else {
      this.hoveredCell = null;
      this.stackTargetId = null;
    }
    local.drawGridSkeleton(draggingIds, this.hoveredCell, this.stackTargetId);
  }

  private onGlobalUp(e?: FederatedPointerEvent): void {
    if (this.destroyed) return;
    if (this.pinchStart) return;
    if (
      this.activeGesturePointerId !== null &&
      e !== undefined &&
      e.pointerId !== this.activeGesturePointerId
    ) {
      return;
    }
    this.activeGesturePointerId = null;
    this.attackDragCandidate = null;
    this.longPress.cancel();
    this.longPress.releaseFired();
    if (this.unassignDrag) {
      const ud = this.unassignDrag;
      this.unassignDrag = null;
      if (ud.overOwn) {
        this.callbacks.onUnassignAttacker?.(ud.cardId);
      } else {
        const state = ud.region.getLastState();
        if (state) ud.region.updateBattlefield(state);
      }
      return;
    }
    if (this.draggingDelim !== null) {
      this.draggingDelim = null;
      return;
    }
    if (this.blockDragBlockerId) {
      this.callbacks.onUnassignBlock?.(this.blockDragBlockerId);
      this.setBlockDragId(null);
      return;
    }
    const local = this.localRegion();
    const selection = this.selection;
    if (!local || !selection) return;

    if (this.attackDragAttackerId) {
      const draggedIds = [...this.dragHandler.draggingCardIds];
      const targetId = this.attackDragTargetId;
      const result = this.dragHandler.end();
      this.setAttackDragId(null);
      local.hideGridSkeleton();
      if (result?.wasDrag) {
        for (const id of draggedIds) {
          const opt = this.attackerOptions.find((a) => a.attackerId === id);
          if (!opt) continue;
          if (targetId && opt.validTargetIds.includes(targetId)) {
            this.callbacks.onAssignAttacker?.(id, targetId);
          } else {
            this.callbacks.onUnassignAttacker?.(id);
          }
        }
      }
      const state = local.getLastState();
      if (state) local.updateBattlefield(state);
      return;
    }

    if (selection.isMarqueeActive()) {
      selection.endMarquee(local.snapshotCurrentPositions());
      return;
    }

    const draggedIds = [...this.dragHandler.draggingCardIds];
    const primaryId = this.dragHandler.primaryDraggingCardId;
    const result = this.dragHandler.end();
    const stackTargetId = this.stackTargetId;
    const hoveredCell = this.hoveredCell;
    this.stackTargetId = null;
    this.hoveredCell = null;
    local.hideGridSkeleton();

    if (!result?.wasDrag) return;
    if (stackTargetId && draggedIds.length > 0) {
      local.commitStackDrop(draggedIds, stackTargetId);
    } else if (hoveredCell) {
      local.commitCellDrop(draggedIds, hoveredCell, primaryId);
    }
    const state = local.getLastState();
    if (state) local.updateBattlefield(state);
  }

  private tick = (): void => {
    if (this.destroyed) return;
    if (import.meta.env.DEV) this.samplePerf();
    this.easeDelimiters();
    for (const rec of this.regions.values()) rec.region.animate();
    this.hand?.animate();
    this.phaseStrip.tick();
    const stripA = this.phaseStrip.container.alpha;
    if (Math.abs(stripA - this.phaseStripAlphaTarget) > 0.01) {
      this.phaseStrip.container.alpha = stripA + (this.phaseStripAlphaTarget - stripA) * 0.2;
    } else {
      this.phaseStrip.container.alpha = this.phaseStripAlphaTarget;
    }
    this.animateFloaters();
    this.captureStackSeeds();
    const handReserve = this.handReserveBottom();
    if (this.handReserveCb && handReserve !== this.lastEmittedHandReserve) {
      this.lastEmittedHandReserve = handReserve;
      this.handReserveCb(handReserve);
    }
    if (this.dropActive) {
      const local = this.localRegion();
      if (this.hand?.isDraggingPermanent()) {
        const canvasRect = this.app.canvas.getBoundingClientRect();
        local?.drawDropGrid(
          this.cursorViewportX - canvasRect.left,
          this.cursorViewportY - canvasRect.top,
        );
      } else {
        local?.drawDropField();
      }
    }
  };

  private samplePerf(): void {
    const ticker = this.app.ticker;
    this.perfFrames += 1;
    this.perfTotalDelta += ticker.deltaMS;
    const fps = ticker.FPS;
    if (fps < this.perfMinFps) this.perfMinFps = fps;
    if (fps > this.perfMaxFps) this.perfMaxFps = fps;
    const now = performance.now();
    if (this.perfLastFlush === 0) this.perfLastFlush = now;
    if (now - this.perfLastFlush < FPS_SAMPLE_INTERVAL_MS) return;
    useGameDevStore.getState().setPixiPerfStats({
      fps: this.perfFrames / ((now - this.perfLastFlush) / 1000),
      minFps: this.perfMinFps === Infinity ? 0 : this.perfMinFps,
      maxFps: this.perfMaxFps,
      deltaMs: this.perfTotalDelta / Math.max(1, this.perfFrames),
    });
    this.perfFrames = 0;
    this.perfTotalDelta = 0;
    this.perfMinFps = Infinity;
    this.perfMaxFps = 0;
    this.perfLastFlush = now;
  }

  private captureStackSeeds(): void {
    const now = performance.now();
    for (const seed of this.stackProvider?.getSeeds() ?? []) {
      this.stackCardSeeds.set(seed.cardId, { x: seed.x, y: seed.y, scale: seed.scale, ts: now });
    }
    // Seeds for cards that just left the stack persist until their TTL so a
    // resolving spell still has a position to fly from.
    for (const [id, seed] of this.stackCardSeeds) {
      if (now - seed.ts > STACK_SEED_TTL_MS) this.stackCardSeeds.delete(id);
    }
  }

  getArrowDefs(): ArrowDef[] {
    if (this.destroyed) return [];
    const castDragging = this.hand?.isDraggingPermanent() ?? false;
    const interacting =
      !!this.castingArrow ||
      castDragging ||
      !!this.blockDragBlockerId ||
      !!this.attackDragAttackerId;
    // Suppress the (card-anchored) combat arrows while the accordion eases so they
    // don't lag their moving targets — but keep live drag/casting arrows, or the
    // player loses targeting feedback exactly when combat opens the fields.
    if (this.delimitersSettling() && !interacting) return [];
    if (this.arrowSpecs.length === 0 && !interacting) return [];
    const canvasRect = this.app.canvas.getBoundingClientRect();
    const resolved: ArrowDef[] = [];
    const attackTargetCounts = new Map<string, number>();
    for (const s of this.arrowSpecs) {
      if (s.type === "attack" && s.to.kind === "player") {
        attackTargetCounts.set(s.to.id, (attackTargetCounts.get(s.to.id) ?? 0) + 1);
      }
    }
    const attackTargetSeen = new Map<string, number>();
    for (const spec of this.arrowSpecs) {
      const from = this.resolveArrowEndpoint(spec.from, canvasRect);
      const to = this.resolveTargetEndpoint(spec.to, canvasRect);
      if (!from || !to) continue;
      if (spec.type === "attack" && spec.to.kind === "player") {
        const total = attackTargetCounts.get(spec.to.id) ?? 1;
        if (total > 1) {
          const idx = attackTargetSeen.get(spec.to.id) ?? 0;
          attackTargetSeen.set(spec.to.id, idx + 1);
          to.pos.x += (idx - (total - 1) / 2) * ATTACK_ARROW_LANE_PX;
        }
      }
      const pointer = this.theme.gameTheme.pointer;
      const color =
        spec.hostile == null
          ? undefined
          : hexToNum(spec.hostile ? pointer.hostile : pointer.friendly);
      // Placement arrows landing in a visible field also outline the target slot.
      let slot: { width: number; height: number } | undefined;
      if (spec.type === "placement" && spec.to.kind === "placement-ghost" && !to.hint) {
        const region = spec.to.playerId
          ? this.regions.get(spec.to.playerId)?.region
          : this.localRegion();
        const rect = region?.getPlacementGhostRect();
        if (rect) slot = { width: rect.width, height: rect.height };
      }
      resolved.push({
        fromX: from.x,
        fromY: from.y,
        toX: to.pos.x,
        toY: to.pos.y,
        type: spec.type,
        color,
        hint: to.hint,
        slot,
      });
    }
    if (this.castingArrow) {
      // Resolve via the stack layer first — robust for casts from any zone
      // (incl. the command zone, which has no sprite); fall back to the card
      // resolver for battlefield ability sources.
      const id = this.castingArrow.sourceCardId;
      const from =
        this.stackProvider?.getCastingAnchor(id) ??
        this.resolveArrowEndpoint({ kind: "card", id }, canvasRect);
      if (from) {
        const t = this.theme.gameTheme.pointer;
        resolved.push({
          fromX: from.x,
          fromY: from.y,
          toX: this.cursorViewportX - canvasRect.left,
          toY: this.cursorViewportY - canvasRect.top,
          type: "casting",
          color: hexToNum(this.castingArrow.hostile ? t.hostile : t.friendly),
        });
      }
    }
    if (this.blockDragBlockerId) {
      const from = this.resolveArrowEndpoint(
        { kind: "card", id: this.blockDragBlockerId },
        canvasRect,
      );
      if (from) {
        resolved.push({
          fromX: from.x,
          fromY: from.y,
          toX: this.cursorViewportX - canvasRect.left,
          toY: this.cursorViewportY - canvasRect.top,
          type: "block",
        });
      }
    }
    if (this.attackDragAttackerId) {
      const from = this.resolveArrowEndpoint(
        { kind: "card", id: this.attackDragAttackerId },
        canvasRect,
      );
      if (from) {
        let toX = this.cursorViewportX - canvasRect.left;
        let toY = this.cursorViewportY - canvasRect.top;
        if (this.attackDragTargetId) {
          const tgt = this.attackTargets.find((t) => t.id === this.attackDragTargetId);
          const to = this.resolveTargetEndpoint(
            tgt?.kind === "player"
              ? { kind: "player", id: this.attackDragTargetId }
              : { kind: "card", id: this.attackDragTargetId },
            canvasRect,
          );
          if (to) {
            toX = to.pos.x;
            toY = to.pos.y;
          }
        }
        resolved.push({
          fromX: from.x,
          fromY: from.y,
          toX,
          toY,
          type: "attack",
          color: hexToNum(this.theme.gameTheme.pointer.hostile),
        });
      }
    }
    if (castDragging) {
      const id = this.hand?.getDraggingCardId();
      // A permanent dragged from a zone with no sprite (the command zone) falls
      // back to its React element by card id.
      const from = id
        ? (this.hand?.getCardPosition(id) ??
          this.domCenterCanvasLocal(`[data-card-id="${CSS.escape(id)}"]`, canvasRect))
        : null;
      if (from) {
        resolved.push({
          fromX: from.x,
          fromY: from.y,
          toX: this.cursorViewportX - canvasRect.left,
          toY: this.cursorViewportY - canvasRect.top,
          type: "placement",
        });
      }
    }
    return resolved;
  }

  private resolveTargetEndpoint(
    ep: ArrowEndpoint,
    canvasRect: DOMRect,
  ): { pos: ScreenPos; hint: boolean } | null {
    if (ep.kind === "card") {
      for (const rec of this.regions.values()) {
        const pos = rec.region.getCardPosition(ep.id);
        if (!pos) continue;
        if (rec.region.isCollapsed()) return { pos: rec.region.getBandCenter(), hint: true };
        return { pos, hint: false };
      }
    } else if (ep.kind === "zone-tile" || (ep.kind === "placement-ghost" && ep.playerId)) {
      const region = this.regions.get(ep.playerId!)?.region;
      if (region?.isCollapsed()) return { pos: region.getBandCenter(), hint: true };
    }
    const pos = this.resolveArrowEndpoint(ep, canvasRect);
    return pos ? { pos, hint: false } : null;
  }

  private resolveArrowEndpoint(ep: ArrowEndpoint, canvasRect: DOMRect): ScreenPos | null {
    switch (ep.kind) {
      case "card": {
        for (const rec of this.regions.values()) {
          const pos = rec.region.getCardPosition(ep.id);
          if (pos) return pos;
        }
        const handPos = this.hand?.getCardPosition(ep.id);
        if (handPos) return handPos;
        return this.domCenterCanvasLocal(`[data-card-id="${CSS.escape(ep.id)}"]`, canvasRect);
      }
      case "player":
        return (
          this.playerBars.getPlayerAnchor(ep.id) ??
          this.domCenterCanvasLocal(`[data-player-id="${CSS.escape(ep.id)}"]`, canvasRect)
        );
      case "stack":
        return this.stackProvider?.getAnchor(ep.id) ?? null;
      case "placement-ghost": {
        const region = ep.playerId ? this.regions.get(ep.playerId)?.region : this.localRegion();
        return region?.getPlacementGhostCenter() ?? null;
      }
      case "zone-tile":
        return (
          this.regions.get(ep.playerId)?.region.getZoneTileCenter(ep.key) ??
          this.playerBars.getZoneAnchor(ep.playerId, ep.key) ??
          this.playerBars.getPlayerAnchor(ep.playerId)
        );
    }
  }

  private domCenterCanvasLocal(selector: string, canvasRect: DOMRect): ScreenPos | null {
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (import.meta.env.DEV) useGameDevStore.getState().setPixiPerfStats(null);
    this.cancelHoverClear();
    window.removeEventListener("pointermove", this.cursorListener);
    window.removeEventListener("pointercancel", this.gestureCancelListener);
    this.app.canvas.removeEventListener("pointerdown", this.stripOutsideListener);
    this.app.canvas.removeEventListener("pointerdown", this.pinchDownListener);
    window.removeEventListener("pointermove", this.pinchMoveListener);
    window.removeEventListener("pointerup", this.pinchUpListener);
    window.removeEventListener("pointercancel", this.pinchUpListener);
    this.longPress.cancel();
    this.app.canvas.removeEventListener("pointerleave", this.canvasLeaveListener);
    this.app.ticker.remove(this.tick, this);
    this.app.stage.off("pointermove", this.onStageMove);
    this.app.stage.off("pointerup", this.onStageUp);
    this.app.stage.off("pointerupoutside", this.onStageUp);
    try {
      this.dragHandler.destroy();
      this.phaseStrip.destroy();
      this.playerBars.destroy();
      this.hand?.destroy();
      this.selection?.destroy();
      for (const rec of this.regions.values()) rec.region.destroy();
      for (const f of this.floaters) f.text.destroy();
      this.floaters = [];
    } catch (err) {
      console.warn("[pixi] BoardScene teardown threw:", err);
    }
    this.regions.clear();
  }
}

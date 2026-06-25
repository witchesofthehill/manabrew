import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import type { CardDto, PlaymatSettings } from "@/protocol/game";
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
import { CARD_W, CARD_H } from "@/components/game/game.constants";
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
import { BoardRegion } from "./BoardRegion";
import {
  PlayerBarLayer,
  PLAYER_BAR_HEIGHT_PX,
  SELF_PLAYER_BAR_HEIGHT_PX,
  PLAYER_BAR_TOP_MARGIN_PX,
  PLAYER_BAR_SIDE_MARGIN_PX,
  PLAYER_BAR_MAX_WIDTH_PX,
  PLAYER_BAR_COLUMN_HEIGHT_PX,
  type PlayerBarSpec,
} from "./PlayerBarLayer";
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

const GRIP_HIT_WIDTH_PX = 16;
const GRIP_BAR_WIDTH_PX = 4;
/** Battleground outline: each opponent's clip band is stroked in their seat
 *  colour so the fields read as distinct rectangles. */
const FIELD_BORDER_WIDTH_PX = 2;
const FIELD_BORDER_ALPHA = 0.5;

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

  private declareBlockers = false;
  private blockDragBlockerId: string | null = null;
  private phaseStripAlphaTarget = 1;

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
  private externalBlockers: BlockingRect[] = [];

  private hoveredCell: GridCell | null = null;
  private stackTargetId: string | null = null;
  private dropActive = false;

  private hoveredCardId: string | null = null;
  private hoveredRegionRef: BoardRegion | null = null;
  private hoverClearTimer: number | null = null;

  private handInsetLeft = 0;
  private handInsetRight = 0;
  private playerBlockers = new Map<string, BlockingRect[]>();
  private autoSort = false;

  // Delimiters (opponent clip bands). Owned and eased here, not in React.
  // `delimCurrent`/`delimTarget` are `count - 1` ascending fractions of width.
  private boardWidth = 0;
  private topHeight = 0;
  private opponentIds: string[] = [];
  private opponentColors = new Map<string, number>();
  private delimCurrent: number[] = [];
  private delimTarget: number[] = [];
  private focusPlayerId: string | null = null;
  private draggingDelim: number | null = null;
  private hoveredOpponentId: string | null = null;
  private gripLayer: Container;
  private gripHandles: Graphics[] = [];
  private framesGfx: Graphics;
  private highlightGfx: Graphics;
  private playerBars: PlayerBarLayer;
  private barsEnabled = false;

  private cursorViewportX = 0;
  private cursorViewportY = 0;
  private cursorListener: (e: MouseEvent) => void;
  private canvasLeaveListener: () => void;
  private onStageMove = (e: FederatedPointerEvent): void => this.onGlobalMove(e);
  private onStageUp = (): void => this.onGlobalUp();

  constructor(app: Application, callbacks: GameCanvasCallbacks) {
    this.app = app;
    this.callbacks = callbacks;
    this.theme = getTheme();

    this.root = new Container();
    this.root.sortableChildren = true;
    app.stage.addChild(this.root);
    app.stage.eventMode = "static";

    this.dragHandler = new DragHandler();

    this.stripBackgroundGfx = new Graphics();
    this.stripBackgroundGfx.eventMode = "none";
    this.stripBackgroundGfx.zIndex = 5;
    this.root.addChild(this.stripBackgroundGfx);

    // Field outlines sit above the regions; the hover highlight above that;
    // the grip handles on top.
    this.framesGfx = new Graphics();
    this.framesGfx.eventMode = "none";
    this.framesGfx.zIndex = 5400;
    this.root.addChild(this.framesGfx);

    this.highlightGfx = new Graphics();
    this.highlightGfx.eventMode = "none";
    this.highlightGfx.zIndex = 5500;
    this.root.addChild(this.highlightGfx);

    this.playerBars = new PlayerBarLayer(this.theme, (id) => this.callbacks.onTargetPlayer?.(id));
    this.playerBars.container.zIndex = 5600;
    this.playerBars.container.visible = false;
    this.root.addChild(this.playerBars.container);

    this.gripLayer = new Container();
    this.gripLayer.zIndex = 6000;
    this.root.addChild(this.gripLayer);

    this.phaseStrip = new PhaseStripLayer(this.theme);
    this.phaseStrip.container.zIndex = 7000;
    this.root.addChild(this.phaseStrip.container);

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
    };
    window.addEventListener("mousemove", this.cursorListener);
    this.canvasLeaveListener = () => this.hand?.clearHover();
    this.app.canvas.addEventListener("pointerleave", this.canvasLeaveListener);

    app.ticker.add(this.tick, this);
    prewarmManaSymbols();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  get canvasElement(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }

  configure(players: BoardPlayerSpec[], layout: BoardLayout, cardScale: number): void {
    if (this.destroyed) return;
    this.cardScale = cardScale;
    const seen = new Set<string>();
    let oppIndex = 0;

    for (const spec of players) {
      const opp = spec.isLocal ? null : layout.opponents[oppIndex++];
      const zone = opp?.rect ?? layout.self;
      const orientation: RegionOrientation = spec.isLocal ? "bottom" : (opp?.orientation ?? "top");
      // The clip bands tile the canvas (no overlap), so z-order is cosmetic.
      const zIndex = spec.isLocal ? 100 : 50;
      seen.add(spec.playerId);
      const existing = this.regions.get(spec.playerId);
      if (existing) {
        existing.zone = zone;
        existing.region.container.zIndex = zIndex;
        existing.region.setZone(zone, orientation);
        existing.region.setCardScale(cardScale);
        existing.region.setPlaymatSettings(spec.playmatSettings);
        existing.region.setPlaymat(spec.playmat);
        continue;
      }
      const region = new BoardRegion(
        this.makeRegionHost(spec.playerId, spec.isLocal),
        this.root,
        zone,
        cardScale,
        { orientation },
      );
      region.setPlaymatSettings(spec.playmatSettings);
      region.setPlaymat(spec.playmat);
      region.container.zIndex = zIndex;
      region.setAutoSort(this.autoSort);
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
    this.opponentColors = new Map(
      players.filter((p) => !p.isLocal && p.color).map((p) => [p.playerId, hexToNum(p.color!)]),
    );
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
    this.dragHandler.setCardScale(cardScale);
    this.dragHandler.setContainerSize(this.app.renderer.width, this.app.renderer.height);
    this.dragHandler.setExtraBlockers(this.externalBlockers);
    if (selfZone && this.hand) this.dragHandler.setHandExclusion(this.hand.getBlockerRect());
  }

  /** Set which opponent's field auto-expands (their turn), or `null` for an even
   *  split (our turn). The delimiters ease to this in `tick`. */
  setOpponentFocus(playerId: string | null): void {
    if (this.focusPlayerId === playerId) return;
    this.focusPlayerId = playerId;
    this.recomputeDelimTarget();
  }

  private recomputeDelimTarget(): void {
    const n = this.opponentIds.length;
    // Hover opens a field the same way its turn does, and takes priority over
    // the turn focus while the cursor is over it.
    const focus = this.hoveredOpponentId ?? this.focusPlayerId;
    const idx = focus ? this.opponentIds.indexOf(focus) : -1;
    if (n <= 1 || this.boardWidth <= 0 || idx < 0) {
      this.delimTarget = evenDelimiters(n);
      return;
    }
    const banner = COLLAPSED_OPPONENT_WIDTH_PX / this.boardWidth;
    const focused = Math.max(banner, 1 - (n - 1) * banner);
    const target: number[] = [];
    let acc = 0;
    for (let i = 0; i < n - 1; i++) {
      acc += i === idx ? focused : banner;
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
  }

  /** Apply the current delimiters to each opponent region as a clip band, and
   *  reposition the grip handles. Bands tile the canvas, so no card ever moves —
   *  only the masks change. */
  private applyDelimiters(): void {
    this.layoutSelfBar();
    const n = this.opponentIds.length;
    const W = this.boardWidth;
    if (n <= 0 || W <= 0) return;
    for (let i = 0; i < n; i++) {
      const rec = this.regions.get(this.opponentIds[i]!);
      if (!rec) continue;
      const left = Math.round((i === 0 ? 0 : this.delimCurrent[i - 1]!) * W);
      const right = Math.round((i === n - 1 ? 1 : this.delimCurrent[i]!) * W);
      const bandW = Math.max(0, right - left);
      rec.region.setClip(left, bandW);
      if (this.barsEnabled) {
        // A field clipped down to (about) its banner width → collapsed column;
        // otherwise a left-aligned bar capped at the max width. A top margin
        // keeps it off the screen edge.
        const column = bandW <= COLLAPSED_OPPONENT_WIDTH_PX + 4;
        const avail = Math.max(0, bandW - PLAYER_BAR_SIDE_MARGIN_PX * 2);
        // Expanded bar keeps a FIXED width and overflows a narrow field rather
        // than resizing/reflowing its contents as the field eases.
        const barW = column ? avail : PLAYER_BAR_MAX_WIDTH_PX;
        const barH = column
          ? Math.min(this.topHeight - PLAYER_BAR_TOP_MARGIN_PX, PLAYER_BAR_COLUMN_HEIGHT_PX)
          : PLAYER_BAR_HEIGHT_PX;
        this.playerBars.setRect(
          this.opponentIds[i]!,
          left + PLAYER_BAR_SIDE_MARGIN_PX,
          PLAYER_BAR_TOP_MARGIN_PX,
          barW,
          barH,
          column,
        );
      }
    }
    this.drawFrames();
    this.layoutGripHandles();
    this.drawHoverHighlight();
  }

  private layoutSelfBar(): void {
    if (!this.barsEnabled || !this.localPlayerId) return;
    const zone = this.localZone();
    if (!zone) return;
    const pad = 8;
    const width = Math.min(Math.max(0, zone.width - pad * 2), PLAYER_BAR_MAX_WIDTH_PX);
    this.playerBars.setRect(
      this.localPlayerId,
      zone.x + pad,
      zone.y + zone.height - SELF_PLAYER_BAR_HEIGHT_PX - pad,
      width,
      SELF_PLAYER_BAR_HEIGHT_PX,
      false,
    );
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
  }

  /** Outline each opponent's clip band in its seat colour so the battlegrounds
   *  read as distinct rectangles. */
  private drawFrames(): void {
    const g = this.framesGfx;
    g.clear();
    const n = this.opponentIds.length;
    const W = this.boardWidth;
    if (n <= 1 || W <= 0) return;
    const neutral = hexToNum(this.theme.gameTheme.canvas.neutral);
    for (let i = 0; i < n; i++) {
      const left = Math.round((i === 0 ? 0 : this.delimCurrent[i - 1]!) * W);
      const right = Math.round((i === n - 1 ? 1 : this.delimCurrent[i]!) * W);
      const color = this.opponentColors.get(this.opponentIds[i]!) ?? neutral;
      g.roundRect(left, 0, Math.max(0, right - left), this.topHeight, TABLE_RADIUS);
      g.stroke({ color, width: FIELD_BORDER_WIDTH_PX, alpha: FIELD_BORDER_ALPHA });
    }
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
      });
      this.gripLayer.addChild(handle);
      this.gripHandles.push(handle);
    }
  }

  private layoutGripHandles(): void {
    const W = this.boardWidth;
    const h = this.topHeight;
    for (let i = 0; i < this.gripHandles.length; i++) {
      const handle = this.gripHandles[i]!;
      handle.position.set((this.delimCurrent[i] ?? (i + 1) / (this.gripHandles.length + 1)) * W, 0);
      handle.hitArea = new Rectangle(-GRIP_HIT_WIDTH_PX / 2, 0, GRIP_HIT_WIDTH_PX, h);
      handle.clear();
      // Full-height divider bar — the visible shared edge between the two fields.
      handle.roundRect(-GRIP_BAR_WIDTH_PX / 2, 0, GRIP_BAR_WIDTH_PX, h, GRIP_BAR_WIDTH_PX / 2);
      handle.fill({ color: 0xffffff, alpha: 0.45 });
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

  private updateHoveredOpponent(localX: number, localY: number): void {
    const n = this.opponentIds.length;
    const W = this.boardWidth;
    let hovered: string | null = null;
    if (n > 0 && W > 0 && localY >= 0 && localY <= this.topHeight) {
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
    const g = this.highlightGfx;
    g.clear();
    const id = this.hoveredOpponentId;
    const i = id ? this.opponentIds.indexOf(id) : -1;
    if (i < 0 || this.boardWidth <= 0) return;
    const W = this.boardWidth;
    const left = Math.round((i === 0 ? 0 : this.delimCurrent[i - 1]!) * W);
    const right = Math.round((i === this.opponentIds.length - 1 ? 1 : this.delimCurrent[i]!) * W);
    const color = this.opponentColors.get(id!) ?? hexToNum(this.theme.gameTheme.cardRing);
    g.roundRect(left, 0, Math.max(0, right - left), this.topHeight, TABLE_RADIUS);
    g.fill({ color, alpha: 0.12 });
    g.stroke({ color, width: 2, alpha: 0.7 });
  }

  private setupLocalControllers(region: BoardRegion): void {
    this.hand = new HandController(this.makeHandHost(), this.root);
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
  }

  private positionPhaseStrip(layout: BoardLayout): void {
    this.lastLayout = layout;
    this.phaseStrip.container.x = layout.self.x;
    this.phaseStrip.container.y = layout.dividerY - STRIP_BAND_PX / 2;
    this.phaseStrip.resize(layout.self.width, STRIP_BAND_PX);
    this.drawStripBackground(layout);
  }

  private drawStripBackground(layout: BoardLayout): void {
    const g = this.stripBackgroundGfx;
    g.clear();
    const y = layout.dividerY - STRIP_BAND_PX / 2;
    g.roundRect(layout.self.x, y, layout.self.width, STRIP_BAND_PX, TABLE_RADIUS);
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

  private refreshPhaseStripDim(): void {
    let active = false;
    for (const rec of this.regions.values()) {
      if (rec.region.getLastState()?.cards.some((c) => c.isAttacking)) {
        active = true;
        break;
      }
    }
    this.phaseStripAlphaTarget = active ? PHASE_STRIP_COMBAT_ALPHA : 1;
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

  setPhaseStripState(state: PhaseStripState): void {
    this.phaseStrip.update(state);
  }

  setPhaseStripCallbacks(cb: PhaseStripCallbacks): void {
    this.phaseStrip.setCallbacks(cb);
  }

  setExternalBlockers(rects: BlockingRect[]): void {
    this.externalBlockers = rects;
    this.dragHandler.setExtraBlockers(rects);
    const local = this.localRegion();
    if (local) local.updateBattlefield(local.getLastState() ?? ({ cards: [] } as BattlefieldState));
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

  setTheme(theme: Theme): void {
    if (this.destroyed) return;
    this.theme = theme;
    setCardSpriteTheme(theme);
    this.phaseStrip.setTheme(theme);
    this.playerBars.setTheme(theme);
    if (this.lastLayout) {
      this.drawStripBackground(this.lastLayout);
    }
    for (const rec of this.regions.values()) rec.region.redrawTheme();
  }

  resize(width: number, height: number): void {
    if (this.destroyed) return;
    this.app.renderer.resize(width, height);
    this.dragHandler.setContainerSize(width, height);
  }

  private makeRegionHost(playerId: string, isLocal: boolean): RegionHost {
    return {
      getTheme: () => this.theme,
      collectBlockers: () => [
        ...(this.playerBlockers.get(playerId) ?? []),
        ...(isLocal ? this.localBlockers() : []),
      ],
      getEntrySeed: (cardId) => this.entrySeedFor(playerId, isLocal, cardId),
      isSelected: (cardId) => (isLocal ? (this.selection?.has(cardId) ?? false) : false),
      rebuildOverlay: (entry, state) => {
        if (isLocal) this.overlay?.rebuild(entry, state);
      },
      wireSprite: (sprite) => this.wireSprite(sprite, playerId, isLocal),
      screenXToLocalX: (screenX) => screenX - this.app.canvas.getBoundingClientRect().left,
      getHandReserveBottom: () => (isLocal ? this.handReserveBottom() : 0),
      getTopReserve: () =>
        !isLocal && this.barsEnabled ? PLAYER_BAR_HEIGHT_PX + PLAYER_BAR_TOP_MARGIN_PX * 2 : 0,
      spawnFloatingText: (x, y, content, color) => this.spawnFloatingText(x, y, content, color),
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

  private localBlockers(): BlockingRect[] {
    const rects = [...this.externalBlockers];
    const handRect = this.hand?.getBlockerRect();
    if (handRect) rects.push(handRect);
    return rects;
  }

  private entrySeedFor(
    playerId: string,
    isLocal: boolean,
    cardId: string,
  ): { x: number; y: number; scaleX: number; scaleY: number } {
    if (isLocal && this.hand) {
      const live = this.hand.getLiveSpriteTransform(cardId);
      if (live) return live;
      const stack = this.stackCardSeeds.get(cardId);
      if (stack) return { x: stack.x, y: stack.y, scaleX: stack.scale, scaleY: stack.scale };
      const origin = this.hand.getOriginSeed();
      return { x: origin.x, y: origin.y, scaleX: origin.scale, scaleY: origin.scale };
    }
    const stack = this.stackCardSeeds.get(cardId);
    if (stack) return { x: stack.x, y: stack.y, scaleX: stack.scale, scaleY: stack.scale };
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
    };
  }

  private wireSprite(sprite: CardSprite, playerId: string, isLocal: boolean): void {
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    const region = this.regions.get(playerId)?.region;
    if (isLocal) {
      sprite.on("pointerdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        this.onBattlefieldCardDown(sprite, e);
      });
      sprite.on("pointertap", () => {
        if (this.dragHandler.justDraggedCardIds.has(sprite.card.id)) return;
        this.overlay?.handleCardTap(sprite.card);
      });
    } else {
      sprite.on("pointertap", () => {
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

  private setBattlefieldCardHovered(region: BoardRegion, sprite: CardSprite): void {
    if (this.hand?.hasActiveHover()) return;
    this.cancelHoverClear();
    if (this.hoveredCardId === sprite.card.id) return;
    const prevRegion = this.hoveredRegionRef;
    if (prevRegion && prevRegion !== region) prevRegion.setHoveredCard(null);
    this.hoveredRegionRef = region;
    this.hoveredCardId = sprite.card.id;
    region.setHoveredCard(sprite.card.id);

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
    const local = this.localRegion();
    const selection = this.selection;
    if (!local || !selection) return;
    if (this.declareBlockers && local.getLastState()?.selectableCardIds?.includes(sprite.card.id)) {
      this.setBlockDragId(sprite.card.id);
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
    selection.refresh();
  }

  private onGlobalMove(e: FederatedPointerEvent): void {
    if (this.destroyed) return;
    const pos = this.root.toLocal(e.global);
    this.updateHoveredOpponent(pos.x, pos.y);
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

  private onGlobalUp(): void {
    if (this.destroyed) return;
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
    // Skip the per-node getBoundingClientRect scan (forces a layout reflow) when
    // the stack is empty — the common case. Captured seeds persist via their TTL.
    if (document.querySelector("[data-stack-object-id]") === null) {
      if (this.stackCardSeeds.size > 0) {
        for (const [id, seed] of this.stackCardSeeds) {
          if (now - seed.ts > STACK_SEED_TTL_MS) this.stackCardSeeds.delete(id);
        }
      }
      return;
    }
    const canvasRect = this.app.canvas.getBoundingClientRect();
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

  getArrowDefs(): ArrowDef[] {
    if (this.destroyed) return [];
    const castDragging = this.hand?.isDraggingPermanent() ?? false;
    if (
      this.arrowSpecs.length === 0 &&
      !this.castingArrow &&
      !castDragging &&
      !this.blockDragBlockerId
    )
      return [];
    const canvasRect = this.app.canvas.getBoundingClientRect();
    const resolved: ArrowDef[] = [];
    for (const spec of this.arrowSpecs) {
      const from = this.resolveArrowEndpoint(spec.from, canvasRect);
      const to = this.resolveArrowEndpoint(spec.to, canvasRect);
      if (!from || !to) continue;
      resolved.push({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, type: spec.type });
    }
    if (this.castingArrow) {
      // Resolve via the stack's `data-casting-card` marker first — robust for
      // casts from any zone (incl. the command zone, which has no sprite); fall
      // back to the card resolver for battlefield ability sources.
      const id = this.castingArrow.sourceCardId;
      const from =
        this.domCenterCanvasLocal(`[data-casting-card="${CSS.escape(id)}"]`, canvasRect) ??
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
        return this.domCenterCanvasLocal(`[data-player-id="${CSS.escape(ep.id)}"]`, canvasRect);
      case "stack":
        return this.domCenterCanvasLocal(
          `[data-stack-object-id="${CSS.escape(ep.id)}"]`,
          canvasRect,
        );
      case "placement-ghost": {
        const region = ep.playerId ? this.regions.get(ep.playerId)?.region : this.localRegion();
        return region?.getPlacementGhostCenter() ?? null;
      }
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
    window.removeEventListener("mousemove", this.cursorListener);
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

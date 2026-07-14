import {
  Container,
  Graphics,
  Point as PixiPoint,
  Sprite,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import type { CardDto, CombatAssignmentDto, PlaymatSettings } from "@/protocol/game";
import { CardSprite } from "../CardSprite";
import { BoardZoneTiles, type ZoneTileSpec } from "./BoardZoneTiles";
import type { BattlefieldState, PlayZoneRect, ScreenPos } from "../types";
import {
  cellAt,
  cellFromPoint,
  cellKey,
  cellsByDistance,
  combatRowReserve,
  computeGridLayout,
  type GridCell,
  type GridLayoutInfo,
} from "../GridLayout";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { hexToNum } from "../colorUtils";
import { lerp, safeDestroy } from "./pixiHelpers";
import { EffectsLayer } from "../effects/EffectsLayer";
import { playStomp } from "../effects/stomp";
import { animationsEnabled } from "../effects/enabled";
import {
  applyCardOverrides,
  useGameDevStore,
  DEBUG_KEYWORD_CARD_ID,
} from "@/stores/useGameDevStore";
import {
  ATTACH_OFFSET_Y,
  BATTLEFIELD_LERP,
  BG_ALPHA_DROP,
  BG_ALPHA_IDLE,
  CARD_RADIUS,
  COMBAT_DIM_ALPHA,
  COMBAT_DIM_TINT_LEVEL,
  DAMAGE_SHAKE_AMP_PX,
  DAMAGE_SHAKE_FRAMES,
  EXIT_FADE_LERP,
  EXIT_SHRINK,
  GAP,
  COMBAT_BLOCKER_OVERLAP_FRAC,
  COMBAT_ROW_PAD_Y,
  COMBAT_ROW_STEP_FRAC,
  COMBAT_STAGE_FAN_FRAC,
  GRID_SKELETON_FILL_ALPHA,
  GRID_SKELETON_FILL_ALPHA_COMPACT,
  GRID_SKELETON_STROKE_ALPHA_COMPACT,
  GRID_SKELETON_HOVER_ALPHA,
  GRID_SKELETON_STACK_ALPHA,
  GRID_SKELETON_STACK_FILL_ALPHA,
  GRID_SKELETON_STROKE_ALPHA,
  HOVER_SCALE,
  HOVER_SCALE_LERP,
  MAX_GRID_SLOTS,
  MAX_LAND_SLOTS,
  OVERLAY_FADE_LERP,
  ROTATION_LERP,
  SNAP_ALPHA,
  SNAP_PX,
  SNAP_ROT,
  SNAP_SCALE,
  STACK_MAX_SLIDE_CARDS,
  TABLE_RADIUS,
  Z_COMBAT_STAGED,
  Z_GRID_SKELETON,
  Z_OVERLAY_OFFSET,
} from "../constants";
import type { BlockingRect, RegionHost, SceneCombatStaging, SpriteEntry } from "./types";
import { COLLAPSED_OPPONENT_WIDTH_PX, type RegionOrientation } from "./boardLayout";
import {
  PLAYER_HUD_HEIGHT_PX,
  PLAYER_HUD_MAX_WIDTH_PX,
  PLAYER_HUD_TOP_MARGIN_PX,
} from "../hud/PlayerHudLayer";
import { PlaymatLayer, playmatPad } from "./PlaymatLayer";
import { loadAvatarTexture } from "../hud/avatarTextureCache";
import { applyIcon } from "../panelIcons";

const COMBAT_ROW_BOT_ICON = "robot-antennas";

type Point = ScreenPos;

interface BoardRegionOptions {
  orientation: RegionOrientation;
}

const ENTRANCE_LAND_PX = 8;
const GLIDE_LAND_PX = 24;

const COMBAT_ROW_AVATAR_D = 24;

/** Keyed by the card object. The engine mints fresh `CardDto` objects per state
 *  update, so a real change recomputes; the many re-layout passes that reuse the
 *  same objects (resize, blockers, combat staging) hit the cache. */
const stackKeyCache = new WeakMap<CardDto, string>();

const SCRATCH_POINT = new PixiPoint();

/** Derived from the whole engine DTO rather than a hand-picked field list, so
 *  every property the engine reports splits the stack automatically. Only `id`
 *  (always unique) is excluded. */
function stackIdentityKey(c: CardDto): string {
  const cached = stackKeyCache.get(c);
  if (cached !== undefined) return cached;
  const key = JSON.stringify(c, (k, value) => (k === "id" ? undefined : value));
  stackKeyCache.set(c, key);
  return key;
}

export class BoardRegion {
  readonly container: Container;
  private host: RegionHost;
  private mirrored: boolean;
  private zone!: PlayZoneRect;
  private clipX: number | null = null;
  private clipWidth: number | null = null;
  private cardScale: number;

  private backgroundGfx: Graphics;
  private clipGfx: Graphics;
  private playmat = new PlaymatLayer();
  private effects = new EffectsLayer();
  private gridSkeletonGfx: Graphics;
  private zoneTiles: BoardZoneTiles;
  private zoneTileKeys: string[] = [];
  private compactZones = false;
  private zoneTilesLocked = false;
  private zoneSlots = new Map<string, { col: number; row: number }>();

  private entries = new Map<string, SpriteEntry>();
  private gridInfo: GridLayoutInfo | null = null;
  private gridTargets = new Map<string, Point>();
  private userSlots = new Map<string, { col: number; row: number }>();
  private userPlacedCards = new Set<string>();
  private uiParent = new Map<string, string>();
  private stackCounts = new Map<string, number>();
  private nameGroupChildren = new Set<string>();
  private combatStaging: SceneCombatStaging | null = null;
  private attackTargetRingId: string | null = null;
  private combatRowAttackerIds = new Set<string>();
  private combatRowBlocks: CombatAssignmentDto[] = [];
  private combatRowBlockerIds = new Set<string>();
  private skeletonDebug = false;
  private attackRowDebug = false;
  private attackRowDebugGfx = new Graphics();
  private combatRowGroups: NonNullable<BattlefieldState["combatRowGroups"]> = [];
  private combatRowGfx = new Graphics();
  private combatRowLabels: Text[] = [];
  private combatRowAvatars: { sprite: Sprite; mask: Graphics; url: string | null }[] = [];
  private effectiveChildrenMap = new Map<string, string[]>();
  private lastState: BattlefieldState | null = null;
  private pendingDropSlot: { col: number; row: number } | null = null;
  private lastDropCell: { col: number; row: number } | null = null;
  private hoveredCardId: string | null = null;
  private dropActive = false;
  private autoSort = false;
  private combatDim = false;

  constructor(
    host: RegionHost,
    parent: Container,
    zone: PlayZoneRect,
    cardScale: number,
    options: BoardRegionOptions,
  ) {
    this.host = host;
    this.cardScale = cardScale;
    this.mirrored = options.orientation !== "bottom";

    this.container = new Container();
    this.container.label = "boardRegion";
    this.container.sortableChildren = true;
    parent.addChild(this.container);
    this.applyOrientation(zone);

    this.clipGfx = new Graphics();
    this.clipGfx.label = "regionClip";
    this.container.addChild(this.clipGfx);
    this.updateClip();

    this.backgroundGfx = new Graphics();
    this.backgroundGfx.zIndex = -10;
    this.container.addChild(this.backgroundGfx);

    this.playmat.container.zIndex = -9;
    this.playmat.setMirrored(this.mirrored);
    this.container.addChild(this.playmat.container);

    // Above the felt, below the cards.
    this.effects.container.zIndex = 0;
    this.container.addChild(this.effects.container);

    this.combatRowGfx.eventMode = "none";
    this.combatRowGfx.zIndex = Z_COMBAT_STAGED - 5;
    this.container.addChild(this.combatRowGfx);
    this.attackRowDebugGfx.eventMode = "none";
    this.attackRowDebugGfx.visible = false;
    this.attackRowDebugGfx.zIndex = Z_COMBAT_STAGED - 6;
    this.container.addChild(this.attackRowDebugGfx);

    this.gridSkeletonGfx = new Graphics();
    this.gridSkeletonGfx.eventMode = "none";
    this.gridSkeletonGfx.visible = false;
    this.gridSkeletonGfx.zIndex = Z_GRID_SKELETON;
    this.container.addChild(this.gridSkeletonGfx);

    this.zoneTiles = new BoardZoneTiles(this.host.getTheme(), {
      onDragMove: (cx, cy) => this.drawDropGrid(cx, cy),
      onDrop: (key, cx, cy) => this.onZoneTileMoved(key, cx, cy),
      onDragEnd: () => this.hideGridSkeleton(),
      onPreview: (card, bounds) => this.host.previewCard(card, bounds),
      isPointerTapSuppressed: (pointerId) => this.host.isPointerTapSuppressed(pointerId),
    });
    // Above the combat-row band (`combatRowGfx`, Z_COMBAT_STAGED - 5) so a zone
    // tile parked in the inner-edge attack slot (mirrored fields) sits on top of
    // the red strip instead of being dimmed beneath it — still below staged
    // attacker cards and the row's avatar/label header.
    this.zoneTiles.container.zIndex = Z_COMBAT_STAGED - 4;
    this.applyZoneTileDraggable();
    this.container.addChild(this.zoneTiles.container);

    this.drawBackground();
  }

  /** The deck/graveyard/exile/command tiles for this player. `BoardScene` feeds
   *  the per-player specs; they occupy grid cells (bottom-left by default). */
  setZoneTiles(specs: ZoneTileSpec[]): void {
    this.zoneTileKeys = specs.map((s) => s.key);
    this.zoneTiles.setSpecs(specs);
    if (this.lastState) this.updateBattlefield(this.lastState);
    else this.placeZoneTiles(this.freshGrid(), new Set());
  }

  setCompactZones(compact: boolean): void {
    if (this.compactZones === compact) return;
    this.compactZones = compact;
    this.applyZoneTileDraggable();
    if (this.lastState) this.updateBattlefield(this.lastState);
    else this.placeZoneTiles(this.freshGrid(), new Set());
  }

  setZoneTilesLocked(locked: boolean): void {
    if (this.zoneTilesLocked === locked) return;
    this.zoneTilesLocked = locked;
    this.applyZoneTileDraggable();
  }

  private applyZoneTileDraggable(): void {
    this.zoneTiles.setDraggable(!this.mirrored && !this.compactZones && !this.zoneTilesLocked);
  }

  cancelZoneTileDrag(): void {
    this.zoneTiles.cancelDrag();
  }

  cancelZoneTileDragForPointer(pointerId: number): void {
    this.zoneTiles.cancelDragForPointer(pointerId);
  }

  private freshGrid(): GridLayoutInfo {
    return computeGridLayout(
      this.playArea(),
      0,
      this.collectLocalBlockers(),
      this.cardScale,
      this.zoneTileKeys.length > 0,
    );
  }

  /** Assign each zone tile a grid cell (persisted slot, else the next free cell
   *  scanning column-major from the player's near edge — a vertical stack up
   *  from bottom-left for the local player, down from top-left for mirrored
   *  opponents), reserve those cells in `occupied` so cards avoid them, and push
   *  the pixel placements to the tile layer. Mirrored opponents extend each
   *  column into the reserved attack-row band (synthetic row `grid.rows`) so the
   *  stack flows into that inner-edge slot before wrapping to the next column. */
  private placeZoneTiles(grid: GridLayoutInfo, occupied: Set<string>): void {
    const placements = new Map<string, { x: number; y: number }>();
    const taken = new Set<string>();
    const ignoreBlockers = this.compactZones && !this.mirrored;
    const isFree = (cell: GridCell | null, ignoreBlocked = ignoreBlockers): cell is GridCell =>
      !!cell &&
      !taken.has(cellKey(cell.col, cell.row)) &&
      !occupied.has(cellKey(cell.col, cell.row)) &&
      (ignoreBlocked || !cell.blocked);

    const attackBandRow = grid.rows;
    const resolveCell = (col: number, row: number): GridCell | null => {
      if (row !== attackBandRow) return cellAt(grid, col, row);
      if (!this.mirrored || col < 0 || col >= grid.cols) return null;
      const x = grid.originX + col * grid.cellW;
      const cy = this.frontEdgeY();
      const y = cy - grid.cardH / 2;
      return { col, row, x, y, cx: x + grid.cardW / 2, cy, blocked: false };
    };

    const gridRows =
      this.mirrored || this.compactZones
        ? Array.from({ length: grid.rows }, (_, r) => r)
        : Array.from({ length: grid.rows }, (_, r) => grid.rows - 1 - r);
    const rowOrder = this.mirrored ? [...gridRows, attackBandRow] : gridRows;
    const nextDefaultCell = (ignoreBlocked = ignoreBlockers): GridCell | null => {
      for (let col = 0; col < grid.cols; col++) {
        for (const row of rowOrder) {
          const cell = resolveCell(col, row);
          if (isFree(cell, ignoreBlocked)) return cell;
        }
      }
      return null;
    };

    for (const key of this.zoneTileKeys) {
      const slot = this.compactZones ? undefined : this.zoneSlots.get(key);
      let cell = slot ? resolveCell(slot.col, slot.row) : null;
      if (!isFree(cell)) cell = nextDefaultCell();
      // A giant-card grid (few cells, partly covered by the hand fan and
      // action cluster keep-outs) can run out of unblocked cells — overlap a
      // blocker rather than stranding the tile at its stale geometry.
      if (!cell) cell = nextDefaultCell(true);
      if (!cell) continue;
      if (!this.compactZones) this.zoneSlots.set(key, { col: cell.col, row: cell.row });
      taken.add(cellKey(cell.col, cell.row));
      occupied.add(cellKey(cell.col, cell.row));
      placements.set(key, { x: cell.x, y: cell.y });
    }
    this.zoneTiles.setGeometry(
      CARD_W * this.cardScale,
      CARD_H * this.cardScale,
      placements,
      this.touchHitPadScreen(),
    );
  }

  private onZoneTileMoved(key: string, centerX: number, centerY: number): void {
    const grid = this.gridInfo;
    if (!grid) return;
    const cell = cellFromPoint(grid, centerX, centerY);
    if (cell && !cell.blocked) this.zoneSlots.set(key, { col: cell.col, row: cell.row });
    // Re-place tiles (snapping the drop, or reverting an invalid one) and relayout
    // cards to avoid the new cells.
    if (this.lastState) this.updateBattlefield(this.lastState);
    else this.placeZoneTiles(this.freshGrid(), new Set());
  }

  /** Card sprites sit above and stop propagation, so this fires only on empty
   *  felt. */
  enableFeltMarquee(onDown: (e: FederatedPointerEvent) => void): void {
    this.backgroundGfx.eventMode = "static";
    this.backgroundGfx.on("pointerdown", onDown);
  }

  setZone(zone: PlayZoneRect, orientation: RegionOrientation): void {
    const prev = this.zone;
    const zoneChanged =
      !prev ||
      prev.x !== zone.x ||
      prev.y !== zone.y ||
      prev.width !== zone.width ||
      prev.height !== zone.height;
    this.mirrored = orientation !== "bottom";
    this.playmat.setMirrored(this.mirrored);
    this.applyZoneTileDraggable();
    this.applyOrientation(zone);
    this.updateClip();
    this.drawBackground();
    // Card positions depend only on the FIXED zone + scale + blockers — never on
    // the clip. A zone-only change relayouts (which re-places the tiles); the
    // clip is set separately.
    if (zoneChanged && this.lastState) this.updateBattlefield(this.lastState);
  }

  /** Set the visible clip band (mask only — never relayouts cards). `BoardScene`
   *  owns and eases the delimiters, calling this each frame. Null = no clip. */
  setClip(clipX: number | null, clipWidth: number | null): void {
    if (this.clipX === clipX && this.clipWidth === clipWidth) return;
    this.clipX = clipX;
    this.clipWidth = clipWidth;
    this.updateClip();
    // The playmat fits the visible band, so re-fit it as the band eases.
    this.playmat.layout(this.bandZone(), { dropActive: this.dropActive });
    if (this.combatRowAttackerIds.size > 0) this.applyCombatRow();
    if (this.attackRowDebug) this.drawAttackRowDebug();
  }

  private updateClip(): void {
    if (this.clipWidth === null) {
      this.container.mask = null;
      this.clipGfx.clear();
      return;
    }
    const OVERSCAN = 100000;
    this.clipGfx.clear();
    this.clipGfx.rect(this.clipX ?? this.zone.x, -OVERSCAN, this.clipWidth, OVERSCAN * 2);
    this.clipGfx.fill({ color: 0xffffff });
    this.container.mask = this.clipGfx;
  }

  private applyOrientation(screenRect: PlayZoneRect): void {
    this.zone = screenRect;
    this.container.rotation = 0;
    this.container.position.set(0, 0);
  }

  private localToCanvas(x: number, y: number): ScreenPos {
    SCRATCH_POINT.set(x, y);
    const p = this.container.toGlobal(SCRATCH_POINT, SCRATCH_POINT);
    return { x: p.x, y: p.y };
  }

  private canvasToLocal(x: number, y: number): ScreenPos {
    SCRATCH_POINT.set(x, y);
    const p = this.container.toLocal(SCRATCH_POINT, undefined, SCRATCH_POINT);
    return { x: p.x, y: p.y };
  }

  private collectLocalBlockers(): BlockingRect[] {
    const blockers = this.host.collectBlockers().map((r) => {
      const p1 = this.canvasToLocal(r.x, r.y);
      const p2 = this.canvasToLocal(r.x + r.width, r.y + r.height);
      return { x: p1.x, y: p1.y, width: p2.x - p1.x, height: p2.y - p1.y };
    });
    if (this.mirrored && !this.compactZones) {
      // The opponent HUD capsule (avatar / life / badges) sits at the top-left
      // of the band; block just its cells so the grid uses the rest of the top
      // instead of reserving the whole bar-height band across the field.
      // Compact skips this estimate — the scene supplies the capsule's live
      // rendered bounds instead, and the 280px-wide estimate would over-block
      // cells the 0.7-scaled capsule doesn't cover.
      const bandLeft = this.clipX ?? this.zone.x;
      blockers.push({
        x: bandLeft,
        y: this.zone.y,
        width: Math.min(PLAYER_HUD_MAX_WIDTH_PX, this.clipWidth ?? this.zone.width),
        height: PLAYER_HUD_HEIGHT_PX + PLAYER_HUD_TOP_MARGIN_PX * 2,
      });
    }
    return blockers;
  }

  setCardScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0 || scale === this.cardScale) return;
    this.cardScale = scale;
    if (this.lastState) this.updateBattlefield(this.lastState);
    else this.placeZoneTiles(this.freshGrid(), new Set());
  }

  getCardScale(): number {
    return this.cardScale;
  }

  setDropActive(active: boolean): void {
    if (this.dropActive === active) return;
    this.dropActive = active;
    if (active) {
      this.lastDropCell = null;
    } else {
      this.pendingDropSlot = this.lastDropCell;
      this.lastDropCell = null;
      this.hideGridSkeleton();
    }
    this.drawBackground();
  }

  setAutoSort(value: boolean): void {
    if (this.autoSort === value) return;
    this.autoSort = value;
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  setHoveredCard(cardId: string | null): void {
    this.hoveredCardId = cardId;
  }

  setCombatDim(active: boolean): void {
    this.combatDim = active;
  }

  private isCombatant(card: CardDto): boolean {
    if (card.isAttacking) return true;
    const s = this.combatStaging;
    return !!s && (s.attackerIds.has(card.id) || s.blockerIds.has(card.id));
  }

  private isDeclaredBlocker(cardId: string): boolean {
    if (this.combatStaging?.blockerIds.has(cardId)) return true;
    return this.combatRowBlocks.some((b) => b.blockerId === cardId);
  }

  setPendingDropSlot(slot: { col: number; row: number } | null): void {
    this.pendingDropSlot = slot;
  }

  getGridInfo(): GridLayoutInfo | null {
    return this.gridInfo;
  }

  getGridTargets(): ReadonlyMap<string, Point> {
    return this.gridTargets;
  }

  getEntries(): ReadonlyMap<string, SpriteEntry> {
    return this.entries;
  }

  getUserSlots(): Map<string, { col: number; row: number }> {
    return this.userSlots;
  }

  getCardPosition(cardId: string): ScreenPos | null {
    const entry = this.entries.get(cardId);
    return entry ? this.localToCanvas(entry.targetX, entry.targetY) : null;
  }

  /** Draw the hostile "under attack" ring on `cardId` (a planeswalker/battle the
   *  local player is dragging an attacker onto), or clear it. A card not in this
   *  region is treated as null so the scene can broadcast to every region. */
  setAttackTargetRing(cardId: string | null): void {
    const mine = cardId && this.entries.has(cardId) ? cardId : null;
    if (this.attackTargetRingId === mine) return;
    const prev = this.attackTargetRingId;
    this.attackTargetRingId = mine;
    if (prev && this.lastState) {
      const e = this.entries.get(prev);
      if (e) this.applyBattlefieldRing(e.sprite, this.lastState);
    }
    if (mine) {
      const e = this.entries.get(mine);
      if (e) e.sprite.setRing(hexToNum(this.host.getTheme().gameTheme.pointer.hostile));
    }
  }

  containsPointInCard(cardId: string, canvasX: number, canvasY: number, pad = 0): boolean {
    const entry = this.entries.get(cardId);
    if (!entry) return false;
    const center = this.localToCanvas(entry.targetX, entry.targetY);
    // Battles / planes render sideways — match the landscape footprint so their
    // targeting zone is identical in size to an upright planeswalker's.
    const horizontal = entry.sprite.horizontalFrame;
    const halfW = ((horizontal ? CARD_H : CARD_W) * this.cardScale) / 2 + pad;
    const halfH = ((horizontal ? CARD_W : CARD_H) * this.cardScale) / 2 + pad;
    return Math.abs(canvasX - center.x) <= halfW && Math.abs(canvasY - center.y) <= halfH;
  }

  getZoneTileCenter(key: string): ScreenPos | null {
    const center = this.zoneTiles.getTileCenter(key);
    return center ? this.localToCanvas(center.x, center.y) : null;
  }

  isCollapsed(): boolean {
    return this.clipWidth !== null && this.clipWidth <= COLLAPSED_OPPONENT_WIDTH_PX + 4;
  }

  getBandCenter(): ScreenPos {
    const x =
      this.clipX !== null && this.clipWidth !== null
        ? this.clipX + this.clipWidth / 2
        : this.zone.x + this.zone.width / 2;
    return this.localToCanvas(x, this.zone.y + this.zone.height / 2);
  }

  getLastState(): BattlefieldState | null {
    return this.lastState;
  }

  hasLastState(): boolean {
    return this.lastState !== null;
  }

  applyBaseRing(sprite: CardSprite): void {
    if (this.lastState) this.applyBattlefieldRing(sprite, this.lastState);
  }

  setCombatStaging(staging: SceneCombatStaging | null): void {
    if (staging === null && this.combatStaging === null) return;
    this.combatStaging = staging;
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  animate(): void {
    let exited: string[] | null = null;
    const now = performance.now();
    for (const [id, entry] of this.entries) {
      const s = entry.sprite;
      if (entry.exiting) {
        s.alpha = lerp(s.alpha, 0, EXIT_FADE_LERP, 0.02);
        s.scale.set(s.scale.x * EXIT_SHRINK);
        if (s.alpha <= 0.05) (exited ??= []).push(id);
        continue;
      }
      s.tickEffects(now);
      s.x = lerp(s.x, entry.targetX, BATTLEFIELD_LERP, SNAP_PX);
      s.y = lerp(s.y, entry.targetY, BATTLEFIELD_LERP, SNAP_PX);
      const cp = this.localToCanvas(s.x, s.y);
      this.host.recordCardExit(id, {
        x: cp.x,
        y: cp.y,
        scaleX: s.scale.x,
        scaleY: s.scale.y,
      });
      if (entry.gliding) {
        const dx = s.x - entry.targetX;
        const dy = s.y - entry.targetY;
        if (dx * dx + dy * dy <= GLIDE_LAND_PX * GLIDE_LAND_PX) entry.gliding = false;
      }
      const wantGuest =
        this.combatRowAttackerIds.has(id) ||
        this.combatRowBlockerIds.has(id) ||
        entry.gliding === true;
      const parent = wantGuest ? this.host.getCombatGuestLayer() : this.container;
      if (s.parent !== parent) parent.addChild(s);
      if (entry.pendingEntrance) {
        const dx = s.x - entry.targetX;
        const dy = s.y - entry.targetY;
        if (dx * dx + dy * dy < ENTRANCE_LAND_PX * ENTRANCE_LAND_PX) {
          entry.pendingEntrance = false;
          this.playEntranceFx(entry, s.card);
        }
      }
      if (entry.shakeFrames > 0) {
        const amp = DAMAGE_SHAKE_AMP_PX * (entry.shakeFrames / DAMAGE_SHAKE_FRAMES);
        s.x += (Math.random() - 0.5) * 2 * amp;
        s.y += (Math.random() - 0.5) * 2 * amp;
        entry.shakeFrames -= 1;
      }
      s.rotation = lerp(s.rotation, entry.targetRotation, ROTATION_LERP, SNAP_ROT);
      s.zIndex = entry.targetZIndex;

      // Alpha is owned here (not in updateCard), so a state update mid-combat
      // doesn't snap a dimmed/phased card back to 1 and re-fade it (flicker).
      // Combat dim darkens via tint rather than alpha so overlapping stacked
      // cards don't show through one another; phased-out keeps a real fade.
      const dimmed =
        this.combatDim &&
        this.hoveredCardId !== s.card.id &&
        !this.isCombatant(s.card) &&
        !this.lastState?.selectableCardIds?.includes(s.card.id);
      const curBright = (s.tint & 0xff) / 255;
      const nextBright = lerp(
        curBright,
        dimmed ? COMBAT_DIM_TINT_LEVEL : 1,
        OVERLAY_FADE_LERP,
        0.01,
      );
      const ch = Math.round(nextBright * 255);
      s.tint = (ch << 16) | (ch << 8) | ch;
      s.alpha = lerp(
        s.alpha,
        s.card.phasedOut ? COMBAT_DIM_ALPHA : 1,
        OVERLAY_FADE_LERP,
        SNAP_ALPHA,
      );

      if (entry.etbGlowAlpha > 0) {
        entry.etbGlowAlpha = lerp(entry.etbGlowAlpha, 0, OVERLAY_FADE_LERP, SNAP_ALPHA);
      }
      s.setEntryGlowAlpha(entry.etbGlowAlpha);

      const isHovered = this.hoveredCardId === s.card.id;
      // Landscape cards (split/battle/room) are CARD_H wide, so shrink them to
      // the portrait cell width to sit in the grid without overlapping.
      const fit = s.horizontalFrame ? CARD_W / CARD_H : 1;
      const targetScale = this.cardScale * fit * (isHovered ? HOVER_SCALE : 1);
      entry.scaleBase = lerp(entry.scaleBase, targetScale, HOVER_SCALE_LERP, SNAP_SCALE);
      const fx = s.fxScale;
      s.scale.set(entry.scaleBase * fx.x, entry.scaleBase * fx.y);

      if (entry.overlay?.visible) {
        entry.overlay.x = s.x;
        entry.overlay.y = s.y;
        entry.overlay.scale.set(entry.scaleBase);
        entry.overlay.zIndex = entry.targetZIndex + Z_OVERLAY_OFFSET;
        entry.overlay.alpha = lerp(
          entry.overlay.alpha,
          isHovered ? 1 : 0,
          OVERLAY_FADE_LERP,
          SNAP_ALPHA,
        );
      }
    }
    if (exited) for (const id of exited) this.destroyEntry(id);
    this.effects.tick();
  }

  updateBattlefield(state: BattlefieldState): void {
    if (this.host.isDestroyed() || !state || !Array.isArray(state.cards)) return;
    const prevCards = new Map<string, CardDto>();
    for (const c of this.lastState?.cards ?? []) prevCards.set(c.id, c);
    const isFirstState = this.lastState === null;
    this.lastState = state;
    this.combatRowAttackerIds = new Set(state.combatRowAttackerIds ?? []);
    this.combatRowBlocks = state.combatRowBlocks ?? [];
    this.combatRowBlockerIds = new Set(this.combatRowBlocks.map((b) => b.blockerId));
    this.combatRowGroups = state.combatRowGroups ?? [];
    const cardMap = new Map<string, CardDto>(state.cards.map((c) => [c.id, c]));
    const currentIds = new Set(state.cards.map((c) => c.id));

    for (const childId of this.nameGroupChildren) {
      this.uiParent.delete(childId);
    }
    this.nameGroupChildren.clear();

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
    this.effectiveChildrenMap = effectiveChildren;
    const topLevelCards = state.cards.filter((c) => !effectiveParent.has(c.id));

    this.pruneRemovedBattlefieldEntries(currentIds);
    for (const id of [...this.userSlots.keys()]) {
      if (!currentIds.has(id) || effectiveParent.has(id)) {
        this.userSlots.delete(id);
      }
    }
    const positions = this.computeBattlefieldGrid(topLevelCards);
    this.gridTargets = positions;
    for (const entry of this.entries.values()) this.applyTouchChrome(entry.sprite);

    for (const card of topLevelCards) {
      const center = positions.get(card.id) ?? { x: this.zoneCenterX(), y: this.zoneCenterY() };
      const guest = this.combatRowAttackerIds.has(card.id);
      const childIds = effectiveChildren.get(card.id) ?? [];
      const attachments = childIds
        .map((id) => cardMap.get(id))
        .filter((c): c is CardDto => c !== undefined);
      const visibleSteps = Math.min(attachments.length, STACK_MAX_SLIDE_CARDS - 1);
      const attachStep = ATTACH_OFFSET_Y * this.cardScale;
      const totalOffset = visibleSteps * attachStep;
      const topLeftY = center.y - (CARD_H * this.cardScale) / 2;

      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i]!;
        const stepsAbove = Math.min(attachments.length - i, visibleSteps);
        this.placeBattlefieldCard(
          att,
          center.x,
          topLeftY + totalOffset - stepsAbove * attachStep + (CARD_H * this.cardScale) / 2,
          i + 1,
          state,
          guest,
        );
      }

      this.placeBattlefieldCard(
        card,
        center.x,
        topLeftY + totalOffset + (CARD_H * this.cardScale) / 2,
        attachments.length + 1,
        state,
        guest,
      );
    }

    this.applyCombatStaging();
    this.applyCombatRow();
    this.applyAttackLunge(state);
    if (!isFirstState) {
      const lethal = hexToNum(this.host.getTheme().gameTheme.pt.lethal);
      const cardHalfH = (CARD_H * this.cardScale) / 2;
      const now = performance.now();
      for (const card of state.cards) {
        const entry = this.entries.get(card.id);
        if (!entry) continue;
        const prev = prevCards.get(card.id);
        if (!prev) {
          const guest =
            this.combatRowAttackerIds.has(card.id) ||
            this.combatRowAttackerIds.has(effectiveParent.get(card.id) ?? "");
          if (!guest && !entry.gliding) {
            entry.etbGlowAlpha = 1;
            entry.pendingEntrance = true;
          }
          continue;
        }
        const fx = animationsEnabled();
        if (fx && (card.power !== prev.power || card.toughness !== prev.toughness)) {
          entry.sprite.playStatPop(now);
        }
        const delta = (card.damage ?? 0) - (prev.damage ?? 0);
        if (delta > 0) {
          // The damage number always shows (it's info); only the flash + shake
          // are suppressed by the animation toggle.
          if (fx) {
            entry.sprite.playDamageHit(now);
            entry.shakeFrames = DAMAGE_SHAKE_FRAMES;
          }
          const c = this.localToCanvas(entry.targetX, entry.targetY);
          this.host.spawnFloatingText(c.x, c.y - cardHalfH, `-${delta}`, lethal);
        }
      }
    }
    if (this.skeletonDebug) this.refreshSkeletonDebug();
    if (this.attackRowDebug) this.drawAttackRowDebug();
  }

  private applyAttackLunge(state: BattlefieldState): void {
    const staged = this.combatStaging?.attackerIds;
    const frontY = this.frontEdgeY();
    for (const card of state.cards) {
      if (!card.isAttacking || staged?.has(card.id)) continue;
      const entry = this.entries.get(card.id);
      if (!entry) continue;
      entry.targetY = frontY;
      entry.targetZIndex = Math.max(entry.targetZIndex, Z_COMBAT_STAGED - 1);
      this.stackAttachments(card.id, entry.targetX, frontY, Z_COMBAT_STAGED - 1);
    }
  }

  private applyCombatStaging(): void {
    const staging = this.combatStaging;
    if (!staging) return;
    const frontY = this.frontEdgeY();
    const fanStep = CARD_W * this.cardScale * COMBAT_STAGE_FAN_FRAC;

    for (const id of staging.attackerIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      entry.targetY = frontY;
      entry.targetZIndex = Z_COMBAT_STAGED;
      this.stackAttachments(id, entry.targetX, frontY, Z_COMBAT_STAGED);
    }

    const onAttacker = CARD_H * this.cardScale * COMBAT_BLOCKER_OVERLAP_FRAC;
    for (const b of staging.blockers) {
      const entry = this.entries.get(b.id);
      if (!entry) continue;
      const offset = (b.indexInLane - (b.laneCount - 1) / 2) * fanStep;
      entry.targetX = this.host.screenXToLocalX(b.laneScreenX) + offset;
      entry.targetY = b.attackerY + (this.mirrored ? -onAttacker : onAttacker);
      entry.targetZIndex = Z_COMBAT_STAGED + 1;
      this.stackAttachments(b.id, entry.targetX, entry.targetY, Z_COMBAT_STAGED + 1);
    }
  }

  private stackAttachments(hostId: string, x: number, y: number, baseZ: number): void {
    const attachs = this.effectiveChildrenMap.get(hostId);
    if (!attachs) return;
    attachs.forEach((attId, k) => {
      const att = this.entries.get(attId);
      if (!att) return;
      att.targetX = x;
      att.targetY = y + (this.mirrored ? -1 : 1) * (k + 1) * ATTACH_OFFSET_Y * this.cardScale;
      att.targetZIndex = baseZ - (k + 1);
    });
  }

  private applyCombatRow(): void {
    this.combatRowGfx.clear();
    for (const t of this.combatRowLabels) t.visible = false;
    for (const a of this.combatRowAvatars) a.sprite.visible = false;
    if (this.combatRowAttackerIds.size === 0) return;
    const ids = [...this.combatRowAttackerIds];
    const y = this.frontEdgeY();
    const cardW = CARD_W * this.cardScale;
    const mat = this.playmatRect();
    // Opponent bands hold a zone tile (exile/…) in the attack-row slot (grid
    // col 0), so start the band at col 1's left edge to clear that whole column.
    // grid.originX is full-field (unclipped) space while `mat` is the eased/clipped
    // band, so during the accordion ease col-1 can fall outside the visible band —
    // clamp bandLeft into [mat.x, bandRight] so bandW never inverts.
    const grid = this.gridInfo;
    const bandRight = mat.x + mat.width;
    const bandLeft =
      this.mirrored && this.zoneTileKeys.length > 0 && grid
        ? Math.min(Math.max(grid.originX + grid.cellW, mat.x), bandRight)
        : mat.x;
    const bandW = Math.max(0, bandRight - bandLeft);
    const fullStep = cardW * COMBAT_ROW_STEP_FRAC;
    const fitStep = ids.length > 1 ? (bandW - cardW) / (ids.length - 1) : fullStep;
    const step = Math.max(0, Math.min(fullStep, fitStep));
    const centerX = bandLeft + bandW / 2;
    const startX = centerX - ((ids.length - 1) * step) / 2;

    const attackerX = new Map<string, number>();
    ids.forEach((id, i) => {
      const x = startX + i * step;
      attackerX.set(id, x);
      const entry = this.entries.get(id);
      if (!entry) return;
      entry.targetX = x;
      entry.targetY = y;
      entry.targetZIndex = Z_COMBAT_STAGED;
      this.stackAttachments(id, x, y, Z_COMBAT_STAGED);
    });

    const byAttacker = new Map<string, string[]>();
    for (const b of this.combatRowBlocks) {
      const list = byAttacker.get(b.attackerId);
      if (list) list.push(b.blockerId);
      else byAttacker.set(b.attackerId, [b.blockerId]);
    }
    const onAttacker = CARD_H * this.cardScale * COMBAT_BLOCKER_OVERLAP_FRAC;
    const fanStep = cardW * COMBAT_STAGE_FAN_FRAC;
    const connectors: { ax: number; bx: number; by: number }[] = [];
    for (const [attackerId, blockerIds] of byAttacker) {
      const ax = attackerX.get(attackerId);
      if (ax === undefined) continue;
      blockerIds.forEach((blockerId, i) => {
        const entry = this.entries.get(blockerId);
        if (!entry) return;
        const offset = (i - (blockerIds.length - 1) / 2) * fanStep;
        const bx = ax + offset;
        const by = y + (this.mirrored ? -onAttacker : onAttacker);
        entry.targetX = bx;
        entry.targetY = by;
        entry.targetZIndex = Z_COMBAT_STAGED + 1;
        connectors.push({ ax, bx, by });
      });
    }

    const red = hexToNum(this.host.getTheme().gameTheme.pt.lethal);
    const halfH = (CARD_H * this.cardScale) / 2;
    const stripLeft = bandLeft;
    const stripW = bandW;
    const stripTop = y - halfH - COMBAT_ROW_PAD_Y;
    const stripH = halfH * 2 + COMBAT_ROW_PAD_Y * 2;
    this.combatRowGfx.roundRect(stripLeft, stripTop, stripW, stripH, 10);
    this.combatRowGfx.fill({ color: red, alpha: 0.22 });
    this.combatRowGfx.roundRect(stripLeft, stripTop, stripW, stripH, 10);
    this.combatRowGfx.stroke({ color: red, width: 1.5, alpha: 0.6 });

    if (connectors.length > 0) {
      const defense = hexToNum(this.host.getTheme().gameTheme.promptAction.defenseAction);
      for (const c of connectors) {
        this.combatRowGfx.moveTo(c.ax, y);
        this.combatRowGfx.lineTo(c.bx, c.by);
      }
      this.combatRowGfx.stroke({ color: defense, width: 2, alpha: 0.55 });
    }

    const lightHex = this.host.getTheme().gameTheme.textOnTinted;
    const avatarD = Math.min(COMBAT_ROW_AVATAR_D, stripH - 6);
    const groups = this.combatRowGroups;
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]!;
      const col = hexToNum(group.color);
      const ax = stripLeft + 6 + avatarD / 2;
      // Opponent bands carry a zone tile (exile/…) in the attack-row slot, so the
      // group label sits just *below* the band (far-left, in the gap above the
      // divider) to avoid overlapping anything inside the play area; the self band
      // has no tile there and keeps its top-left anchor inside the strip.
      const ay = this.mirrored
        ? stripTop + stripH + 6 + avatarD / 2 + gi * (avatarD + 4)
        : stripTop + 6 + avatarD / 2 + gi * (avatarD + 4);
      this.combatRowGfx.circle(ax, ay, avatarD / 2);
      this.combatRowGfx.fill({ color: col, alpha: 0.4 });
      this.combatRowGfx.circle(ax, ay, avatarD / 2);
      this.combatRowGfx.stroke({ color: col, width: 1.5 });
      const av = this.combatRowAvatar(gi);
      av.sprite.visible = true;
      av.sprite.position.set(ax, ay);
      av.mask.clear();
      av.mask.circle(ax, ay, avatarD / 2 - 1);
      av.mask.fill({ color: 0xffffff });
      if (group.avatarUrl) {
        this.loadCombatRowAvatar(av, group.avatarUrl, avatarD);
      } else {
        av.url = null;
        applyIcon(av.sprite, COMBAT_ROW_BOT_ICON, lightHex, 64, avatarD * 0.7, avatarD * 0.7);
      }
      const label = this.combatRowLabel(gi);
      label.text = group.label;
      label.style.fill = col;
      label.anchor.set(0, 0.5);
      label.position.set(ax + avatarD / 2 + 6, ay);
      label.visible = true;
    }
  }

  private combatRowAvatar(i: number): { sprite: Sprite; mask: Graphics; url: string | null } {
    let a = this.combatRowAvatars[i];
    if (!a) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      sprite.eventMode = "none";
      sprite.zIndex = Z_COMBAT_STAGED + 2;
      const mask = new Graphics();
      mask.eventMode = "none";
      sprite.mask = mask;
      this.container.addChild(mask, sprite);
      a = { sprite, mask, url: null };
      this.combatRowAvatars[i] = a;
    }
    return a;
  }

  private loadCombatRowAvatar(
    a: { sprite: Sprite; mask: Graphics; url: string | null },
    url: string,
    size: number,
  ): void {
    if (a.url === url) return;
    a.url = url;
    loadAvatarTexture(url)
      .then((tex) => {
        if (a.sprite.destroyed || a.url !== url) return;
        a.sprite.texture = tex;
        a.sprite.width = size;
        a.sprite.height = size;
      })
      .catch(() => {});
  }

  private combatRowLabel(i: number): Text {
    let t = this.combatRowLabels[i];
    if (!t) {
      t = new Text({
        text: "",
        style: {
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 12,
          fontWeight: "800",
          fill: 0xffffff,
          dropShadow: { color: 0x000000, alpha: 0.6, blur: 3, distance: 1, angle: Math.PI / 2 },
        },
      });
      t.anchor.set(0.5);
      t.eventMode = "none";
      t.zIndex = Z_COMBAT_STAGED + 2;
      this.container.addChild(t);
      this.combatRowLabels[i] = t;
    }
    return t;
  }

  private frontEdgeY(): number {
    const halfCard = (CARD_H * this.cardScale) / 2;
    // Anchor the row's outer edge to the playmat border (bottom inner edge for
    // opponents, top inner edge for us), not the raw field edge.
    const mat = this.playmatRect();
    if (this.mirrored) {
      return mat.y + mat.height - COMBAT_ROW_PAD_Y - halfCard;
    }
    return mat.y + COMBAT_ROW_PAD_Y + halfCard;
  }

  private applyNameGrouping(topLevel: CardDto[]): void {
    this.stackCounts.clear();
    if (topLevel.length < 2) return;

    const isStackable = (c: CardDto): boolean =>
      !c.isAttacking &&
      !this.combatStaging?.blockerIds.has(c.id) &&
      !c.attachedTo &&
      !c.isBestowed &&
      !c.isFaceDown &&
      !c.isTransformed &&
      (!c.attachmentIds || c.attachmentIds.length === 0) &&
      !this.userPlacedCards.has(c.id);

    const byIdentity = new Map<string, CardDto[]>();
    for (const c of topLevel) {
      if (!isStackable(c)) continue;
      const key = stackIdentityKey(c);
      const list = byIdentity.get(key);
      if (list) list.push(c);
      else byIdentity.set(key, [c]);
    }

    for (const group of byIdentity.values()) {
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

  private applyOverflowStacking(topLevelCandidates: CardDto[]): void {
    if (topLevelCandidates.length === 0) return;
    const zone = this.playArea();
    const grid = computeGridLayout(
      zone,
      0,
      this.collectLocalBlockers(),
      this.cardScale,
      this.zoneTileKeys.length > 0,
    );
    let freeCellCount = 0;
    for (const cell of grid.cells) {
      if (!cell.blocked) freeCellCount++;
    }
    if (topLevelCandidates.length <= freeCellCount) return;

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

  private computeBattlefieldGrid(cards: CardDto[]): Map<string, Point> {
    const positions = new Map<string, Point>();
    const zone = this.playArea();
    const grid = computeGridLayout(
      zone,
      0,
      this.collectLocalBlockers(),
      this.cardScale,
      this.zoneTileKeys.length > 0,
    );
    this.gridInfo = grid;

    const occupied = new Set<string>();
    // Reserve the zone tiles' cells first so cards lay out around them.
    this.placeZoneTiles(grid, occupied);
    const unplaced: CardDto[] = [];

    for (const c of cards) {
      const slot = this.autoSort ? undefined : this.userSlots.get(c.id);
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

    if (this.pendingDropSlot && unplaced.length > 0) {
      const dropCell = cellAt(grid, this.pendingDropSlot.col, this.pendingDropSlot.row);
      if (dropCell && !dropCell.blocked && !occupied.has(cellKey(dropCell.col, dropCell.row))) {
        const dropCandidate = unplaced[0]!;
        this.userSlots.set(dropCandidate.id, this.pendingDropSlot);
        this.userPlacedCards.add(dropCandidate.id);
        positions.set(dropCandidate.id, { x: dropCell.cx, y: dropCell.cy });
        occupied.add(cellKey(dropCell.col, dropCell.row));
        unplaced.shift();
      }
      this.pendingDropSlot = null;
    }

    const centerX = zone.x + zone.width / 2;

    let lastUsableRow = grid.rows - 1;
    while (lastUsableRow > 0) {
      const midCell = cellAt(grid, Math.floor(grid.cols / 2), lastUsableRow);
      if (midCell && !midCell.blocked) break;
      lastUsableRow--;
    }

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

    if (this.mirrored) {
      const flip = (rows: number[]) => rows.map((r) => lastUsableRow - r);
      creatureRows = flip(creatureRows);
      otherRows = flip(otherRows);
      landRows = flip(landRows);
    }

    type CardCategory = "creature" | "land" | "other";
    const classify = (c: CardDto): CardCategory => {
      if (c.types.includes("Creature")) return "creature";
      if (c.types.includes("Land")) return "land";
      return "other";
    };

    const categoryConfig: Record<CardCategory, { rows: number[]; anchorTop: boolean }> = {
      creature: { rows: creatureRows, anchorTop: !this.mirrored },
      other: { rows: otherRows, anchorTop: !this.mirrored },
      land: { rows: landRows, anchorTop: this.mirrored },
    };

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

      let picked: GridCell | null = null;
      for (let i = 0; i < sorted.length && i < max; i++) {
        const cell = sorted[i]!;
        if (cell.blocked) continue;
        if (occupied.has(cellKey(cell.col, cell.row))) continue;
        if (!rowSet.has(cell.row)) continue;
        picked = cell;
        break;
      }

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

  getPlacementGhostRect(): { x: number; y: number; width: number; height: number } {
    const slot = this.findFirstFreeBattlefieldSlot();
    return {
      x: slot.x,
      y: slot.y,
      width: CARD_W * this.cardScale,
      height: CARD_H * this.cardScale,
    };
  }

  getPlacementGhostCenter(): ScreenPos {
    const r = this.getPlacementGhostRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }

  private findFirstFreeBattlefieldSlot(): Point {
    const zone = this.playArea();
    const grid =
      this.gridInfo ??
      computeGridLayout(
        zone,
        0,
        this.collectLocalBlockers(),
        this.cardScale,
        this.zoneTileKeys.length > 0,
      );
    const occupied = new Set<string>();
    for (const pos of this.gridTargets.values()) {
      const cell = cellFromPoint(grid, pos.x, pos.y);
      if (cell) occupied.add(cellKey(cell.col, cell.row));
    }

    if (this.pendingDropSlot) {
      const dropCell = cellAt(grid, this.pendingDropSlot.col, this.pendingDropSlot.row);
      if (dropCell && !dropCell.blocked && !occupied.has(cellKey(dropCell.col, dropCell.row))) {
        return { x: dropCell.x, y: dropCell.y };
      }
    }

    const anchorX = zone.x + zone.width / 2;
    const anchorY = this.mirrored ? zone.y + zone.height - grid.cellH / 2 : zone.y + grid.cellH / 2;
    const sorted = cellsByDistance(grid, anchorX, anchorY);
    for (const cell of sorted) {
      if (cell.blocked) continue;
      if (occupied.has(cellKey(cell.col, cell.row))) continue;
      return { x: cell.x, y: cell.y };
    }
    return { x: anchorX - grid.cardW / 2, y: anchorY - grid.cardH / 2 };
  }

  private pruneRemovedBattlefieldEntries(currentIds: Set<string>): void {
    for (const [id, entry] of this.entries) {
      if (currentIds.has(id) || entry.exiting) continue;
      entry.exiting = true;
      const c = this.localToCanvas(entry.sprite.x, entry.sprite.y);
      this.host.recordCardExit(id, {
        x: c.x,
        y: c.y,
        scaleX: entry.sprite.scale.x,
        scaleY: entry.sprite.scale.y,
      });
      if (entry.overlay) entry.overlay.visible = false;
      this.userPlacedCards.delete(id);
    }
  }

  private destroyEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.sprite.parent?.removeChild(entry.sprite);
    if (entry.overlay) this.container.removeChild(entry.overlay);
    safeDestroy(entry.sprite);
    if (entry.overlay) safeDestroy(entry.overlay);
    this.entries.delete(id);
  }

  private placeBattlefieldCard(
    card: CardDto,
    centerX: number,
    centerY: number,
    zIndex: number,
    state: BattlefieldState,
    guest = false,
  ): void {
    this.ensureBattlefieldEntry(card);
    const entry = this.entries.get(card.id)!;
    if (entry.exiting) {
      entry.exiting = false;
      entry.sprite.alpha = 1;
    }
    if (guest) {
      const gl = this.host.getCombatGuestLayer();
      if (entry.sprite.parent !== gl) gl.addChild(entry.sprite);
    }
    entry.targetX = centerX;
    entry.targetY = centerY;
    entry.targetZIndex = zIndex;
    const overriddenCard =
      card.id === DEBUG_KEYWORD_CARD_ID
        ? applyCardOverrides(card, useGameDevStore.getState().cardOverrides)
        : card;
    entry.sprite.updateCardContent(overriddenCard);
    entry.sprite.setStackCount(this.stackCounts.get(card.id) ?? 1);
    const orderIdx = state.orderedCardIds?.indexOf(card.id) ?? -1;
    entry.sprite.setOrderBadge(orderIdx >= 0 ? orderIdx + 1 : null);
    entry.targetRotation = overriddenCard.tapped ? (this.mirrored ? -Math.PI / 2 : Math.PI / 2) : 0;
    const ownerColor = state.ownerRingByCard?.[card.id];
    entry.sprite.setOwnerRing(ownerColor ? hexToNum(ownerColor) : null);
    entry.sprite.setMustAttack(state.mustAttackCardIds?.includes(card.id) ?? false);
    this.applyBattlefieldRing(entry.sprite, state);
    this.host.rebuildOverlay(entry, state);
  }

  private touchHitPadScreen(): number {
    const grid = this.gridInfo;
    if (!this.compactZones || !grid) return 0;
    return Math.max(0, Math.min((grid.cellW - grid.cardW) / 2, (grid.cellH - grid.cardH) / 2));
  }

  private applyTouchChrome(sprite: CardSprite): void {
    if (!this.compactZones) {
      sprite.setHitPad(0);
      sprite.setChromeScale(1);
      return;
    }
    sprite.setHitPad(this.touchHitPadScreen() / this.cardScale);
    sprite.setChromeScale(Math.max(1, 1 / this.cardScale));
  }

  private ensureBattlefieldEntry(card: CardDto): void {
    if (this.entries.has(card.id)) return;
    const sprite = new CardSprite(card);
    this.host.wireSprite(sprite);
    this.applyTouchChrome(sprite);
    this.container.addChild(sprite);

    const seed = this.host.getEntrySeed(card.id);
    const local = this.canvasToLocal(seed.x, seed.y);
    sprite.x = local.x;
    sprite.y = local.y;
    sprite.scale.set(seed.scaleX, seed.scaleY);

    this.entries.set(card.id, {
      sprite,
      targetX: sprite.x,
      targetY: sprite.y,
      targetZIndex: 1,
      targetRotation: sprite.rotation,
      etbGlowAlpha: 0,
      scaleBase: sprite.scale.x,
      shakeFrames: 0,
      pendingEntrance: false,
      gliding: seed.glide ?? false,
      overlay: null,
    });
  }

  private applyBattlefieldRing(sprite: CardSprite, state: BattlefieldState): void {
    const theme = this.host.getTheme();
    const card = sprite.card;
    sprite.setDoomed(card.wouldDieInCombat ?? false);
    if (this.attackTargetRingId === card.id) {
      sprite.setRing(hexToNum(theme.gameTheme.pointer.hostile));
      return;
    }
    if (this.isDeclaredBlocker(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.promptAction.defenseAction));
      return;
    }
    if (this.host.isSelected(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.cardRing));
      return;
    }
    // Attacking and summoning-sickness are shown by the card's own edge glow
    // (CardSprite.updateEdgeGlow), not by a ring.
    if (card.wouldDieInCombat) {
      sprite.setRing(hexToNum(theme.gameTheme.pt.lethal));
    } else if (state.pendingCardIds?.includes(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.promptAction.passAction));
    } else if (state.tappableLandIds?.includes(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.cardRing));
    } else if (state.untappableLandIds?.includes(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.promptAction.cancel));
    } else if (state.hostileTargetCardIds?.includes(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.pointer.hostile));
    } else if (state.selectableCardIds?.includes(card.id)) {
      sprite.setRing(
        state.hostileTargeting
          ? hexToNum(theme.gameTheme.arrow.hostileTarget)
          : hexToNum(theme.gameTheme.cardRing),
      );
    } else {
      sprite.setRing(null);
    }
  }

  /** The zone with its bottom trimmed so it clears the hand fan (local player
   *  only) and its top trimmed so the first card row clears the player bar
   *  (opponents). Drives the felt, the empty label, and the card grid. */
  private usableZone(): PlayZoneRect {
    const zone = this.zone;
    const bottom = this.host.getHandReserveBottom();
    const top = this.host.getTopReserve();
    if (bottom <= 0 && top <= 0) return zone;
    return { ...zone, y: zone.y + top, height: Math.max(0, zone.height - top - bottom) };
  }

  /** The felt fills the FIXED `usableZone` — it is drawn once over the full play
   *  area and the delimiter mask (`updateClip`) clips it, so the felt and cards
   *  never move when a delimiter is dragged. */
  private feltZone(): PlayZoneRect {
    return this.usableZone();
  }

  /** The playmat's rect: the visible band horizontally (usable width ∩ clip),
   *  but the FULL field height so it extends under the player panel / bar and
   *  hand reserve rather than stopping at the reserve-trimmed usable zone. */
  private bandZone(): PlayZoneRect {
    const z = this.usableZone();
    const y = this.zone.y;
    const height = this.zone.height;
    if (this.clipX === null || this.clipWidth === null) {
      return { x: z.x, y, width: z.width, height };
    }
    const left = Math.max(z.x, this.clipX);
    const right = Math.min(z.x + z.width, this.clipX + this.clipWidth);
    return { x: left, y, width: Math.max(1, right - left), height };
  }

  /** The VISIBLE playmat rect — `PlaymatLayer`'s uniform inset of the band zone.
   *  The combat row's strip + position align to this so they match the playmat
   *  border on every side. Keep the inset in sync with `PlaymatLayer.layout`. */
  private playmatRect(): PlayZoneRect {
    const b = this.bandZone();
    const pad = playmatPad(b.width, b.height);
    return {
      x: b.x + pad,
      y: b.y + pad,
      width: Math.max(1, b.width - pad * 2),
      height: Math.max(1, b.height - pad * 2),
    };
  }

  private playArea(): PlayZoneRect {
    const z = this.usableZone();
    const pad = playmatPad(z.width, z.height);
    // Every field permanently reserves the inner-edge combat-row band so the
    // grid rows are sized once and never reflow when combat starts/ends; the row
    // shows/hides inside the reserved strip. The inner edge (next to the divider)
    // is the bottom for opponents and the top for the local player.
    const reserve = combatRowReserve(this.cardScale);
    const topReserve = this.mirrored ? 0 : reserve;
    return {
      x: z.x + pad,
      y: z.y + pad + topReserve,
      width: Math.max(1, z.width - pad * 2),
      height: Math.max(1, z.height - pad * 2 - reserve),
    };
  }

  redrawBackground(): void {
    this.drawBackground();
  }

  private drawBackground(): void {
    const felt = this.feltZone();
    this.backgroundGfx.clear();
    this.backgroundGfx.roundRect(felt.x, felt.y, felt.width, felt.height, TABLE_RADIUS);
    this.backgroundGfx.fill({
      color: hexToNum(this.host.getTheme().gameTheme.canvas.background),
      alpha: this.dropActive ? BG_ALPHA_DROP : BG_ALPHA_IDLE,
    });
    this.playmat.layout(this.bandZone(), { dropActive: this.dropActive });
  }

  setPlaymat(url: string | undefined): void {
    this.playmat.setImage(url);
    this.playmat.layout(this.bandZone(), { dropActive: this.dropActive });
  }

  setPlaymatSettings(settings: PlaymatSettings | undefined): void {
    this.playmat.setSettings(settings);
  }

  private zoneCenterX(): number {
    return this.zone.x + this.zone.width / 2;
  }

  private zoneCenterY(): number {
    return this.zone.y + this.zone.height / 2;
  }

  redrawTheme(): void {
    this.drawBackground();
    this.zoneTiles.setTheme(this.host.getTheme());
  }

  restyleCards(): void {
    for (const entry of this.entries.values()) entry.sprite.restyle();
  }

  previewEtb(): void {
    for (const entry of this.entries.values()) {
      entry.etbGlowAlpha = 1;
      this.playEntranceFx(entry, entry.sprite.card);
    }
  }

  private playEntranceFx(entry: SpriteEntry, card: CardDto): void {
    if (!animationsEnabled()) return;
    if (!card.types?.some((t) => t.toLowerCase() === "creature")) return;
    const footX = entry.targetX;
    const footY = entry.targetY + (CARD_H * this.cardScale) / 2;
    playStomp({
      fxScale: entry.sprite.fxScale,
      onImpact: () => this.effects.stompGround(footX, footY),
    });
  }

  redrawHoverDebug(): void {
    for (const entry of this.entries.values()) entry.sprite.redrawHoverDebug();
  }

  getEffectiveChildren(parentId: string): string[] {
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

  followAttachmentsDuringDrag(parentId: string, parentCenter: Point): void {
    const children = this.getEffectiveChildren(parentId);
    if (children.length === 0) return;
    const visibleSteps = Math.min(children.length, STACK_MAX_SLIDE_CARDS - 1);
    const parentEntry = this.entries.get(parentId);
    if (parentEntry) {
      parentEntry.targetY = parentCenter.y;
      parentEntry.sprite.y = parentCenter.y;
      if (parentEntry.overlay?.visible) parentEntry.overlay.y = parentCenter.y;
    }
    for (let i = 0; i < children.length; i++) {
      const childId = children[i]!;
      const child = this.entries.get(childId);
      if (!child) continue;
      const stepsAbove = Math.min(children.length - i, visibleSteps);
      const cy = parentCenter.y - stepsAbove * ATTACH_OFFSET_Y * this.cardScale;
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

  findStackTargetAt(cell: GridCell, exclude: Set<string>): string | null {
    if (!this.gridInfo) return null;
    for (const [id, pos] of this.gridTargets) {
      if (exclude.has(id)) continue;
      const c = cellFromPoint(this.gridInfo, pos.x, pos.y);
      if (c && c.col === cell.col && c.row === cell.row) return id;
    }
    return null;
  }

  commitCellDrop(draggedIds: string[], target: GridCell, primaryId: string | null): void {
    if (!this.gridInfo || draggedIds.length === 0) return;
    const grid = this.gridInfo;

    const sourceCell = new Map<string, GridCell>();
    for (const id of draggedIds) {
      const pos = this.gridTargets.get(id);
      if (!pos) continue;
      const cell = cellFromPoint(grid, pos.x, pos.y);
      if (cell) sourceCell.set(id, cell);
    }

    const primary = primaryId && sourceCell.has(primaryId) ? primaryId : draggedIds[0]!;
    const primarySrc = sourceCell.get(primary);
    const dCol = primarySrc ? target.col - primarySrc.col : 0;
    const dRow = primarySrc ? target.row - primarySrc.row : 0;

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

  commitStackDrop(draggedIds: string[], targetId: string): void {
    for (const id of draggedIds) {
      if (id === targetId) continue;
      if (this.uiParent.get(targetId) === id) this.uiParent.delete(targetId);
      this.uiParent.set(id, targetId);
      this.userSlots.delete(id);
      this.userPlacedCards.delete(id);
    }
  }

  snapshotCurrentPositions(): Map<string, Point> {
    const positions = new Map<string, Point>();
    for (const [id, entry] of this.entries) {
      positions.set(id, { x: entry.sprite.x, y: entry.sprite.y });
    }
    return positions;
  }

  hideGridSkeleton(): void {
    if (this.skeletonDebug) {
      this.refreshSkeletonDebug();
      return;
    }
    this.gridSkeletonGfx.visible = false;
    this.gridSkeletonGfx.clear();
  }

  /** Dev toggle: keep every grid cell's card skeleton drawn for this region,
   *  not just during a drag, so the locked rows are visible for all players. */
  setSkeletonDebug(on: boolean): void {
    if (this.skeletonDebug === on) return;
    this.skeletonDebug = on;
    this.refreshSkeletonDebug();
  }

  private refreshSkeletonDebug(): void {
    if (this.skeletonDebug) this.drawGridSkeleton(new Set(), null, null);
    else {
      this.gridSkeletonGfx.visible = false;
      this.gridSkeletonGfx.clear();
    }
  }

  /** Dev toggle: outline this region's reserved combat-row band (the attack
   *  area) even when no attack is happening, for every player. */
  setAttackRowDebug(on: boolean): void {
    if (this.attackRowDebug === on) return;
    this.attackRowDebug = on;
    this.drawAttackRowDebug();
  }

  private drawAttackRowDebug(): void {
    const gfx = this.attackRowDebugGfx;
    gfx.clear();
    if (!this.attackRowDebug) {
      gfx.visible = false;
      return;
    }
    const halfH = (CARD_H * this.cardScale) / 2;
    const mat = this.playmatRect();
    const stripLeft = mat.x;
    const stripW = mat.width;
    const stripTop = this.frontEdgeY() - halfH - COMBAT_ROW_PAD_Y;
    const stripH = halfH * 2 + COMBAT_ROW_PAD_Y * 2;
    const red = hexToNum(this.host.getTheme().gameTheme.pt.lethal);
    gfx.roundRect(stripLeft, stripTop, stripW, stripH, 10);
    gfx.fill({ color: red, alpha: 0.12 });
    gfx.roundRect(stripLeft, stripTop, stripW, stripH, 10);
    gfx.stroke({ color: red, width: 1.5, alpha: 0.7 });
    gfx.visible = true;
  }

  drawGridSkeleton(
    draggingIds: Set<string>,
    hoveredCell: GridCell | null,
    stackTargetId: string | null,
  ): void {
    const gfx = this.gridSkeletonGfx;
    gfx.clear();
    if (!this.gridInfo || (draggingIds.size === 0 && !this.skeletonDebug)) {
      gfx.visible = false;
      return;
    }
    const grid = this.gridInfo;
    const color = hexToNum(this.host.getTheme().gameTheme.activeAction.active);
    const occupied = new Map<string, string>();
    for (const [id, pos] of this.gridTargets) {
      if (draggingIds.has(id)) continue;
      const c = cellFromPoint(grid, pos.x, pos.y);
      if (c) occupied.set(cellKey(c.col, c.row), id);
    }
    const hoveredKey = hoveredCell ? cellKey(hoveredCell.col, hoveredCell.row) : null;
    let stackKey: string | null = null;
    if (stackTargetId !== null) {
      const pos = this.gridTargets.get(stackTargetId);
      const c = pos ? cellFromPoint(grid, pos.x, pos.y) : null;
      stackKey = c ? cellKey(c.col, c.row) : null;
    }

    for (const cell of grid.cells) {
      if (cell.blocked) continue;
      const key = cellKey(cell.col, cell.row);
      const isStack = key === stackKey;
      const isHover = key === hoveredKey && !isStack;
      const isOccupied = occupied.has(key) && !isStack;
      const baseStroke = this.compactZones
        ? GRID_SKELETON_STROKE_ALPHA_COMPACT
        : GRID_SKELETON_STROKE_ALPHA;
      const baseFill = this.compactZones
        ? GRID_SKELETON_FILL_ALPHA_COMPACT
        : GRID_SKELETON_FILL_ALPHA;
      const strokeAlpha = isStack
        ? GRID_SKELETON_STACK_ALPHA
        : isHover
          ? GRID_SKELETON_HOVER_ALPHA
          : baseStroke;
      const fillAlpha = isStack
        ? GRID_SKELETON_STACK_FILL_ALPHA
        : isHover
          ? GRID_SKELETON_FILL_ALPHA * 4
          : isOccupied
            ? 0
            : baseFill;
      gfx.roundRect(cell.x, cell.y, grid.cardW, grid.cardH, CARD_RADIUS);
      if (fillAlpha > 0) gfx.fill({ color, alpha: fillAlpha });
      gfx.stroke({ color, width: isStack || isHover ? 2 : 1, alpha: strokeAlpha });
    }
    gfx.visible = true;
  }

  drawDropGrid(localX: number, localY: number): void {
    const grid = computeGridLayout(
      this.playArea(),
      0,
      this.collectLocalBlockers(),
      this.cardScale,
      this.zoneTileKeys.length > 0,
    );
    const color = hexToNum(this.host.getTheme().gameTheme.activeAction.active);
    const gfx = this.gridSkeletonGfx;
    gfx.clear();

    const hoveredCell = cellFromPoint(grid, localX, localY);
    this.lastDropCell =
      hoveredCell && !hoveredCell.blocked ? { col: hoveredCell.col, row: hoveredCell.row } : null;
    const hoveredKey =
      hoveredCell && !hoveredCell.blocked ? cellKey(hoveredCell.col, hoveredCell.row) : null;

    for (const cell of grid.cells) {
      if (cell.blocked) continue;
      const key = cellKey(cell.col, cell.row);
      const isHover = key === hoveredKey;
      gfx.roundRect(cell.x, cell.y, grid.cardW, grid.cardH, CARD_RADIUS);
      gfx.fill({
        color,
        alpha: isHover
          ? GRID_SKELETON_FILL_ALPHA * 5
          : this.compactZones
            ? GRID_SKELETON_FILL_ALPHA_COMPACT
            : GRID_SKELETON_FILL_ALPHA,
      });
      gfx.stroke({
        color,
        width: isHover ? 2 : 1,
        alpha: isHover
          ? GRID_SKELETON_HOVER_ALPHA
          : this.compactZones
            ? GRID_SKELETON_STROKE_ALPHA_COMPACT
            : GRID_SKELETON_STROKE_ALPHA,
      });
    }
    gfx.visible = true;
  }

  drawDropField(): void {
    // Instants/sorceries go to the stack, not a cell — no drop slot to capture.
    this.lastDropCell = null;
    const zone = this.playArea();
    const color = hexToNum(this.host.getTheme().gameTheme.arrow.friendlyTarget);
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

  destroy(): void {
    for (const entry of this.entries.values()) {
      entry.sprite.parent?.removeChild(entry.sprite);
      safeDestroy(entry.sprite);
    }
    this.playmat.destroy();
    this.effects.destroy();
    this.zoneTiles.destroy();
    this.container.destroy({ children: true });
    this.entries.clear();
  }
}

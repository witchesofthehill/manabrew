import { Container, Graphics, Text } from "pixi.js";
import type { GameCard } from "@/types/manabrew";
import { CardSprite } from "../CardSprite";
import type { BattlefieldState, PlayZoneRect, ScreenPos } from "../types";
import {
  cellAt,
  cellFromPoint,
  cellKey,
  cellsByDistance,
  computeGridLayout,
  type GridCell,
  type GridLayoutInfo,
} from "../GridLayout";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { hexToNum } from "../colorUtils";
import { EMPTY_LABEL_STYLE } from "../textStyles";
import { lerp, safeDestroy } from "./pixiHelpers";
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
  COMBAT_STAGE_EDGE_INSET,
  COMBAT_STAGE_FAN_FRAC,
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
  TABLE_RADIUS,
  Z_COMBAT_STAGED,
  Z_OVERLAY_OFFSET,
} from "../constants";
import type { RegionHost, SceneCombatStaging, SpriteEntry } from "./types";

type Point = ScreenPos;

interface BoardRegionOptions {
  /** Mirrored (opponent) orientation: lands at the far edge, creatures
   *  toward the center; tap rotation flips. */
  mirrored: boolean;
}

/**
 * Renders one player's battlefield inside a region rect of the unified
 * board canvas: grid auto-layout, attachment stacking, name-grouping +
 * overflow, rings, combat staging, and per-frame animation. Ported from
 * `PixiGameScene`; reaches orchestrator services through `RegionHost`.
 * Interaction (drag/marquee) is wired by the host and operates on this
 * region's exposed grid state.
 */
export class BoardRegion {
  readonly container: Container;
  private host: RegionHost;
  private mirrored: boolean;
  private zone: PlayZoneRect;
  private cardScale: number;

  private backgroundGfx: Graphics;
  private emptyText: Text;

  private entries = new Map<string, SpriteEntry>();
  private gridInfo: GridLayoutInfo | null = null;
  private gridTargets = new Map<string, Point>();
  private userSlots = new Map<string, { col: number; row: number }>();
  private userPlacedCards = new Set<string>();
  private uiParent = new Map<string, string>();
  private stackCounts = new Map<string, number>();
  private nameGroupChildren = new Set<string>();
  private combatStaging: SceneCombatStaging | null = null;
  private lastState: BattlefieldState | null = null;
  private pendingDropSlot: { col: number; row: number } | null = null;
  private hoveredCardId: string | null = null;
  private dropActive = false;

  constructor(
    host: RegionHost,
    parent: Container,
    zone: PlayZoneRect,
    cardScale: number,
    options: BoardRegionOptions,
  ) {
    this.host = host;
    this.zone = zone;
    this.cardScale = cardScale;
    this.mirrored = options.mirrored;

    this.container = new Container();
    this.container.label = "boardRegion";
    this.container.sortableChildren = true;
    parent.addChild(this.container);

    this.backgroundGfx = new Graphics();
    this.container.addChild(this.backgroundGfx);

    this.emptyText = new Text({ text: "No permanents", style: EMPTY_LABEL_STYLE });
    this.emptyText.anchor.set(0.5);
    this.emptyText.visible = false;
    this.container.addChild(this.emptyText);

    this.drawBackground();
  }

  // ── Region geometry ────────────────────────────────────────────────

  setZone(zone: PlayZoneRect): void {
    this.zone = zone;
    this.drawBackground();
    this.layoutEmptyText();
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  setCardScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0 || scale === this.cardScale) return;
    this.cardScale = scale;
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  getCardScale(): number {
    return this.cardScale;
  }

  setDropActive(active: boolean): void {
    if (this.dropActive === active) return;
    this.dropActive = active;
    this.drawBackground();
  }

  setHoveredCard(cardId: string | null): void {
    this.hoveredCardId = cardId;
  }

  setPendingDropSlot(slot: { col: number; row: number } | null): void {
    this.pendingDropSlot = slot;
  }

  // ── Exposed grid state (for the host's drag controller) ────────────

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

  /** Canvas-local target position of a battlefield card, or null. */
  getCardPosition(cardId: string): ScreenPos | null {
    const entry = this.entries.get(cardId);
    return entry ? { x: entry.targetX, y: entry.targetY } : null;
  }

  // ── Combat staging ─────────────────────────────────────────────────

  setCombatStaging(staging: SceneCombatStaging | null): void {
    if (staging === null && this.combatStaging === null) return;
    this.combatStaging = staging;
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  // ── Per-frame animation ────────────────────────────────────────────

  animate(): void {
    for (const entry of this.entries.values()) {
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
  }

  // ── Battlefield layout ─────────────────────────────────────────────

  updateBattlefield(state: BattlefieldState): void {
    if (this.host.isDestroyed() || !state || !Array.isArray(state.cards)) return;
    this.lastState = state;
    const cardMap = new Map<string, GameCard>(state.cards.map((c) => [c.id, c]));
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
    const topLevelCards = state.cards.filter((c) => !effectiveParent.has(c.id));

    this.pruneRemovedBattlefieldEntries(currentIds);
    for (const id of [...this.userSlots.keys()]) {
      if (!currentIds.has(id) || effectiveParent.has(id)) {
        this.userSlots.delete(id);
      }
    }
    const positions = this.computeBattlefieldGrid(topLevelCards);
    this.gridTargets = positions;

    for (const card of topLevelCards) {
      const center = positions.get(card.id) ?? { x: this.zoneCenterX(), y: this.zoneCenterY() };
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

    this.applyCombatStaging();
    this.emptyText.visible = state.cards.length === 0;
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
    }

    for (const b of staging.blockers) {
      const entry = this.entries.get(b.id);
      if (!entry) continue;
      const offset = (b.indexInLane - (b.laneCount - 1) / 2) * fanStep;
      entry.targetX = this.host.screenXToLocalX(b.laneScreenX) + offset;
      entry.targetY = frontY;
      entry.targetZIndex = Z_COMBAT_STAGED + 1;
    }
  }

  private frontEdgeY(): number {
    const half = (CARD_H * this.cardScale) / 2 + COMBAT_STAGE_EDGE_INSET;
    return this.mirrored ? this.zone.y + this.zone.height - half : this.zone.y + half;
  }

  private applyNameGrouping(topLevel: GameCard[]): void {
    this.stackCounts.clear();
    if (topLevel.length < 2) return;

    const isStackable = (c: GameCard): boolean =>
      !c.isAttacking &&
      !this.combatStaging?.blockerIds.has(c.id) &&
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

  private applyOverflowStacking(topLevelCandidates: GameCard[]): void {
    if (topLevelCandidates.length === 0) return;
    const grid = computeGridLayout(this.zone, 0, this.host.collectBlockers(), this.cardScale);
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

    const centerX = this.zone.x + this.zone.width / 2;
    const topAnchorY = this.zone.y + grid.cellH / 2;
    const bottomAnchorY = this.zone.y + this.zone.height - grid.cellH / 2;
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

  private computeBattlefieldGrid(cards: GameCard[]): Map<string, Point> {
    const positions = new Map<string, Point>();
    const zone = this.zone;
    const grid = computeGridLayout(zone, 0, this.host.collectBlockers(), this.cardScale);
    this.gridInfo = grid;

    const occupied = new Set<string>();
    const unplaced: GameCard[] = [];

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

  /** Canvas-local top-left of the next free slot (placement-ghost target). */
  getPlacementGhostCenter(): ScreenPos {
    const slot = this.findFirstFreeBattlefieldSlot();
    return {
      x: slot.x + (CARD_W * this.cardScale) / 2,
      y: slot.y + (CARD_H * this.cardScale) / 2,
    };
  }

  private findFirstFreeBattlefieldSlot(): Point {
    const zone = this.zone;
    const grid =
      this.gridInfo ?? computeGridLayout(zone, 0, this.host.collectBlockers(), this.cardScale);
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

  // ── Entries ────────────────────────────────────────────────────────

  private pruneRemovedBattlefieldEntries(currentIds: Set<string>): void {
    for (const [id, entry] of this.entries) {
      if (currentIds.has(id)) continue;
      this.container.removeChild(entry.sprite);
      if (entry.overlay) this.container.removeChild(entry.overlay);
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
    this.host.rebuildOverlay(entry, state);
  }

  private ensureBattlefieldEntry(card: GameCard): void {
    if (this.entries.has(card.id)) return;
    const isEntering = this.entries.size > 0;
    const sprite = new CardSprite(card);
    this.host.wireSprite(sprite);
    this.container.addChild(sprite);

    const seed = this.host.getEntrySeed(card.id);
    sprite.x = seed.x;
    sprite.y = seed.y;
    sprite.scale.set(seed.scaleX, seed.scaleY);

    this.entries.set(card.id, {
      sprite,
      targetX: sprite.x,
      targetY: sprite.y,
      targetZIndex: 1,
      targetRotation: sprite.rotation,
      etbGlowAlpha: isEntering ? 1 : 0,
      overlay: null,
    });
  }

  private applyBattlefieldRing(sprite: CardSprite, state: BattlefieldState): void {
    const theme = this.host.getTheme();
    if (this.host.isSelected(sprite.card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.cardRing));
      return;
    }
    const card = sprite.card;
    if (state.attackingCardIds?.includes(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.promptAction.attackAction));
    } else if (state.pendingCardIds?.includes(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.promptAction.passAction));
    } else if (state.tappableLandIds?.includes(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.cardRing));
    } else if (state.untappableLandIds?.includes(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.promptAction.cancel));
    } else if (state.selectableCardIds?.includes(card.id)) {
      sprite.setRing(
        state.hostileTargeting
          ? hexToNum(theme.gameTheme.arrow.hostileTarget)
          : hexToNum(theme.gameTheme.cardRing),
      );
    } else if (this.isCreatureCard(card) && card.summoningSick) {
      sprite.setRing(hexToNum(theme.gameTheme.promptAction.cancel), 0.6);
    } else {
      sprite.setRing(null);
    }
  }

  private isCreatureCard(card: GameCard): boolean {
    return card.types?.some((t) => t.toLowerCase() === "creature") ?? false;
  }

  // ── Background + helpers ───────────────────────────────────────────

  private drawBackground(): void {
    const zone = this.zone;
    this.backgroundGfx.clear();
    this.backgroundGfx.roundRect(zone.x, zone.y, zone.width, zone.height, TABLE_RADIUS);
    this.backgroundGfx.fill({
      color: hexToNum(this.host.getTheme().gameTheme.canvas.background),
      alpha: this.dropActive ? BG_ALPHA_DROP : BG_ALPHA_IDLE,
    });
  }

  private layoutEmptyText(): void {
    const zone = this.zone;
    this.emptyText.scale.set(1);
    const maxWidth = zone.width - 16;
    if (maxWidth > 0 && this.emptyText.width > maxWidth) {
      this.emptyText.scale.set(maxWidth / this.emptyText.width);
    }
    this.emptyText.x = this.zoneCenterX();
    this.emptyText.y = this.zoneCenterY();
  }

  private zoneCenterX(): number {
    return this.zone.x + this.zone.width / 2;
  }

  private zoneCenterY(): number {
    return this.zone.y + this.zone.height / 2;
  }

  redrawTheme(): void {
    this.drawBackground();
  }

  destroy(): void {
    this.entries.clear();
  }
}

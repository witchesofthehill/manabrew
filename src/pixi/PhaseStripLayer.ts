/**
 * Horizontal phase strip rendered in Pixi at the vertical center of the canvas.
 * Shows the current phase, enabled stops, and supports click-to-toggle.
 */

import { Container, Graphics, Text, TextStyle, Sprite } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "./colorUtils";
import { applyIcon, getIconColor } from "./panelIcons";

/** Display cells. "combat" is a merged cell that represents all combat sub-phases. */
interface PhaseSpec {
  id: string;
  short: string;
  /** If set, this cell represents multiple phase ids (combat). */
  subPhases?: string[];
  /** If set, stop indicators/toggles use these phase ids instead of the cell phases. */
  indicatorPhases?: string[];
}

const COMBAT_SUB_PHASES = [
  "begin_combat",
  "declare_attackers",
  "declare_blockers",
  "first_strike_damage",
  "combat_damage",
  "end_combat",
];

const COMBAT_LABELS: Record<string, string> = {
  begin_combat: "BC",
  declare_attackers: "ATK",
  declare_blockers: "BLK",
  first_strike_damage: "1ST",
  combat_damage: "DMG",
  end_combat: "EC",
};

const PHASES: PhaseSpec[] = [
  { id: "upkeep", short: "UP" },
  { id: "draw", short: "DR" },
  { id: "main1", short: "M1" },
  {
    id: "combat",
    short: "COMBAT",
    subPhases: COMBAT_SUB_PHASES,
    indicatorPhases: ["declare_attackers"],
  },
  { id: "main2", short: "M2" },
  { id: "end", short: "END" },
  { id: "cleanup", short: "CL" },
];

const CELL_W = 60;
const COMBAT_CELL_W = 84;
const CELL_H = 30;
const CELL_GAP = 5;
const CELL_R = 4;
const COMBAT_ICON_SIZE = 16;
const FONT = "Inter, system-ui, -apple-system, sans-serif";

const FLASH_DURATION_MS = 800;
const FLASH_MAX_EXPAND = 8;

function easeOut(t: number): number {
  const t1 = 1 - t;
  return 1 - t1 * t1 * t1;
}

// ── Indicator shapes for self (bottom) and opponents (top) ────────────
const INDICATOR_SIZE = 13;
const INDICATOR_GAP = 3;
const INDICATOR_MARGIN = 4; // distance from cell edge

type ShapeKind = "triangle" | "diamond" | "circle";

function drawShape(
  gfx: Graphics,
  kind: ShapeKind,
  cx: number,
  cy: number,
  size: number,
  color: number,
  filled: boolean,
  pointUp: boolean,
): void {
  const r = size / 2;
  if (kind === "triangle") {
    const tipY = pointUp ? cy - r : cy + r;
    const baseY = pointUp ? cy + r : cy - r;
    gfx.moveTo(cx, tipY);
    gfx.lineTo(cx - r, baseY);
    gfx.lineTo(cx + r, baseY);
    gfx.closePath();
  } else if (kind === "diamond") {
    gfx.moveTo(cx, cy - r);
    gfx.lineTo(cx + r, cy);
    gfx.lineTo(cx, cy + r);
    gfx.lineTo(cx - r, cy);
    gfx.closePath();
  } else {
    gfx.circle(cx, cy, r * 0.8);
  }
  if (filled) {
    gfx.fill({ color });
  } else {
    gfx.stroke({ color, width: 1.2, alpha: 0.5 });
  }
}

// Text styles — seeded from the current theme; kept in sync by setTheme()
const _initTheme = getTheme().gameTheme;
const normalStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: "600",
  fill: _initTheme.textMuted,
  align: "center",
});
const activeStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: "bold",
  fill: _initTheme.textOnTinted,
  align: "center",
});
const enabledStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: "600",
  fill: _initTheme.textGhost,
  align: "center",
});

interface PhaseIndicatorData {
  cx: number;
  selfCy: number;
  oppCy: number;
  selfEnabled: boolean;
  selfColor: number;
  oppCount: number;
  oppEnabled: boolean[];
  oppColors: number[];
  cellW: number;
  hideIndicators: boolean;
}

interface PhaseCell {
  bg: Graphics;
  flashGfx: Graphics;
  hoverBg: Graphics;
  hitArea: Graphics;
  text: Text;
  icon?: Sprite;
  id: string;
  defaultLabel: string;
  subPhases?: string[];
  indicatorPhases?: string[];
  flashStart: number;
  selfIndicator: Graphics;
  selfHitArea: Graphics;
  selfHovered: boolean;
  oppIndicators: Graphics;
  oppHitAreas: Graphics[];
  oppHovered: boolean[];
  _indData?: PhaseIndicatorData;
  _fx?: number;
  _fy?: number;
  _fw?: number;
  _fc?: number;
}

export interface OpponentInfo {
  id: string;
  /** Display order index (0-2). Determines shape + color. */
  index: number;
}

export interface PhaseStripState {
  currentStep: string;
  isActiveTurn: boolean;
  /** ID of the player whose turn it is. */
  activePlayerId: string;
  /** The local player's ID. */
  myPlayerId: string;
  /** Self-turn enabled phases. */
  selfEnabledPhases: Set<string>;
  /** Per-opponent enabled phases, keyed by opponent id. */
  opponentEnabledPhases: Map<string, Set<string>>;
  /** Ordered opponent list (max 3). */
  opponents: OpponentInfo[];
  isInteractive: boolean;
}

export interface PhaseStripCallbacks {
  onToggleSelfPhase?: (phaseId: string) => void;
  onToggleOpponentPhase?: (opponentId: string, phaseId: string) => void;
}

export class PhaseStripLayer {
  readonly container: Container;
  private theme: Theme;
  private callbacks: PhaseStripCallbacks = {};
  private lastState: PhaseStripState | null = null;
  private cells: PhaseCell[];
  private prevStep: string | null = null;
  private prevIsActiveTurn = false;
  /** Displayed active player — lags behind the real one so the color
   *  doesn't flip during cleanup (engine advances the active player
   *  before the new turn's first phase). */
  private displayActivePlayerId: string | null = null;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private lineGfx: Graphics;
  private stripHitArea: Graphics;
  private hoveredCellIndex = -1;

  constructor(theme: Theme) {
    this.theme = theme;
    this.container = new Container();
    this.container.label = "phaseStrip";

    // Divider line behind the cells
    this.lineGfx = new Graphics();
    this.container.addChild(this.lineGfx);

    // Full-strip hit area for hover detection (show/hide empty indicators)
    this.stripHitArea = new Graphics();
    this.stripHitArea.eventMode = "static";
    this.container.addChild(this.stripHitArea);

    this.cells = [];
    for (const p of PHASES) {
      const bg = new Graphics();
      this.container.addChild(bg);
      const flashGfx = new Graphics();
      this.container.addChild(flashGfx);
      const hoverBg = new Graphics();
      hoverBg.visible = false;
      this.container.addChild(hoverBg);
      // Combat cell gets an icon; default label is empty (icon replaces it)
      let icon: Sprite | undefined;
      const isCombat = !!p.subPhases;
      if (isCombat) {
        icon = new Sprite();
        icon.width = COMBAT_ICON_SIZE;
        icon.height = COMBAT_ICON_SIZE;
        this.container.addChild(icon);
        applyIcon(icon, "cmdsword", getIconColor("cmdsword", this.theme.gameTheme));
      }
      const text = new Text({ text: isCombat ? "" : p.short, style: normalStyle });
      text.anchor.set(0.5, 0.5);
      this.container.addChild(text);
      // Main cell hit area (for hover) — added first so indicators sit on top
      const hitArea = new Graphics();
      hitArea.eventMode = "static";
      hitArea.cursor = "default";
      const cellIndex = this.cells.length; // index for this cell (before push)
      hitArea.on("pointerover", () => {
        this.hoveredCellIndex = cellIndex;
      });
      hitArea.on("pointerout", () => {
        if (this.hoveredCellIndex === cellIndex) this.hoveredCellIndex = -1;
      });
      this.container.addChild(hitArea);

      // Self indicator (bottom — my turn toggle)
      const selfIndicator = new Graphics();
      this.container.addChild(selfIndicator);
      const selfHitArea = new Graphics();
      selfHitArea.eventMode = "static";
      selfHitArea.cursor = "pointer";
      const selfHovered = false;
      selfHitArea.on("pointerdown", () => {
        const phases = p.indicatorPhases ?? p.subPhases ?? [p.id];
        for (const ph of phases) this.callbacks.onToggleSelfPhase?.(ph);
      });
      selfHitArea.on("pointerover", () => {
        cellRef.selfHovered = true;
      });
      selfHitArea.on("pointerout", () => {
        cellRef.selfHovered = false;
      });
      this.container.addChild(selfHitArea);

      const oppIndicators = new Graphics();
      this.container.addChild(oppIndicators);
      const oppHitAreas: Graphics[] = [];
      const oppHovered: boolean[] = [false, false, false];
      for (let oi = 0; oi < 3; oi++) {
        const oha = new Graphics();
        oha.eventMode = "static";
        oha.cursor = "pointer";
        oha.visible = false;
        oha.on("pointerdown", () => {
          const oppState = this.lastState;
          if (!oppState) return;
          const opp = oppState.opponents[oi];
          if (!opp) return;
          const phases = p.indicatorPhases ?? p.subPhases ?? [p.id];
          for (const ph of phases) this.callbacks.onToggleOpponentPhase?.(opp.id, ph);
        });
        oha.on("pointerover", () => {
          cellRef.oppHovered[oi] = true;
        });
        oha.on("pointerout", () => {
          cellRef.oppHovered[oi] = false;
        });
        this.container.addChild(oha);
        oppHitAreas.push(oha);
      }

      const cellRef: PhaseCell = {
        bg,
        flashGfx,
        hoverBg,
        hitArea,
        text,
        icon,
        id: p.id,
        defaultLabel: p.short,
        subPhases: p.subPhases,
        indicatorPhases: p.indicatorPhases,
        flashStart: 0,
        selfIndicator,
        selfHitArea,
        selfHovered,
        oppIndicators,
        oppHitAreas,
        oppHovered,
      };
      const cell = cellRef;
      this.cells.push(cell);
    }
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    normalStyle.fill = theme.gameTheme.textMuted;
    activeStyle.fill = theme.gameTheme.textOnTinted;
    enabledStyle.fill = theme.gameTheme.textGhost;
  }

  setCallbacks(cb: PhaseStripCallbacks): void {
    this.callbacks = cb;
  }

  resize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
    // Cells + divider line are laid out around `canvasWidth / 2` in `update`,
    // which only runs on a phase-state change — so re-run it here or the strip
    // stays positioned for the old width (off-center) until the next phase.
    if (this.lastState) this.update(this.lastState);
  }

  update(state: PhaseStripState): void {
    this.lastState = state;
    const t = this.theme.gameTheme;
    const appTheme = this.theme.appTheme;
    const y = this.canvasHeight / 2 - CELL_H / 2;
    const centerX = this.canvasWidth / 2;

    // Find combat cell index
    const combatIdx = this.cells.findIndex((c) => !!c.subPhases);
    const leftCells = this.cells.slice(0, combatIdx);
    const rightCells = this.cells.slice(combatIdx + 1);

    // Combat cell centered
    const combatX = centerX - COMBAT_CELL_W / 2;

    // Left cells expand leftward from combat
    const cellPositions: number[] = new Array(this.cells.length);
    cellPositions[combatIdx] = combatX;
    let lx = combatX - CELL_GAP;
    for (let i = leftCells.length - 1; i >= 0; i--) {
      lx -= CELL_W;
      cellPositions[i] = lx;
      lx -= CELL_GAP;
    }
    // Right cells expand rightward from combat
    let rx = combatX + COMBAT_CELL_W + CELL_GAP;
    for (let i = 0; i < rightCells.length; i++) {
      cellPositions[combatIdx + 1 + i] = rx;
      rx += CELL_W + CELL_GAP;
    }

    // Divider line — only the edges outside all cells
    const lineY = this.canvasHeight / 2;
    const stripLeft = cellPositions[0]! - CELL_GAP;
    const stripRight = rx;
    this.lineGfx.clear();
    // Left segment
    this.lineGfx.moveTo(0, lineY);
    this.lineGfx.lineTo(stripLeft, lineY);
    const lineColor = hexToNum(t.canvas.neutral);
    this.lineGfx.stroke({ color: lineColor, width: 2, alpha: 0.12 });
    // Right segment
    this.lineGfx.moveTo(stripRight, lineY);
    this.lineGfx.lineTo(this.canvasWidth, lineY);
    this.lineGfx.stroke({ color: lineColor, width: 2, alpha: 0.12 });

    // Strip hover hit area — covers cells + indicator rows
    const hoverPad = INDICATOR_SIZE + INDICATOR_MARGIN + 6;
    this.stripHitArea.clear();
    this.stripHitArea.rect(stripLeft, y - hoverPad, stripRight - stripLeft, CELL_H + hoverPad * 2);
    this.stripHitArea.fill({ color: 0x000000, alpha: 0.001 });

    // Detect phase change for flash
    const turnJustStarted = state.isActiveTurn && !this.prevIsActiveTurn;
    this.prevIsActiveTurn = state.isActiveTurn;
    let stepChanged = false;
    if (turnJustStarted) {
      this.prevStep = state.currentStep;
    } else if (this.prevStep !== null && this.prevStep !== state.currentStep) {
      stepChanged = true;
    }
    this.prevStep = state.currentStep;

    // Determine the active player's color for the bar tint
    const pc = t.playerColors;
    const selfColor = hexToNum(pc.self);
    const oppColors = [hexToNum(pc.opponent1), hexToNum(pc.opponent2), hexToNum(pc.opponent3)];

    // Only update the displayed active player on non-cleanup phases
    // so the bar color doesn't flip early during cleanup.
    if (state.currentStep !== "cleanup") {
      this.displayActivePlayerId = state.activePlayerId;
    }
    const displayActive = this.displayActivePlayerId ?? state.activePlayerId;

    const isMeActive = displayActive === state.myPlayerId;
    const activeOppIdx = state.opponents.findIndex((o) => o.id === displayActive);
    const turnColor = isMeActive
      ? selfColor
      : activeOppIdx >= 0
        ? oppColors[activeOppIdx]!
        : hexToNum(t.textMuted);

    const count = this.cells.length;
    for (let i = 0; i < count; i++) {
      const cell = this.cells[i]!;
      const isCombatCell = !!cell.subPhases;
      const cellW = isCombatCell ? COMBAT_CELL_W : CELL_W;
      const cx = cellPositions[i]!;

      const combatSubActive = isCombatCell && cell.subPhases!.includes(state.currentStep);
      const isCurrentPhase = isCombatCell ? combatSubActive : state.currentStep === cell.id;
      const isActive = isCurrentPhase; // highlight current phase regardless of whose turn
      const phaseIds = cell.indicatorPhases ?? cell.subPhases ?? [cell.id];
      const isEnabled = phaseIds.some((s) => state.selfEnabledPhases.has(s));

      // Combat label: show sub-phase when active, icon-only otherwise
      if (isCombatCell) {
        cell.text.text = combatSubActive ? (COMBAT_LABELS[state.currentStep] ?? "") : "";
      }

      // Combat icon position + tint
      if (cell.icon) {
        const iconTint = isActive
          ? this.theme.gameTheme.textOnTinted
          : getIconColor("cmdsword", this.theme.gameTheme);
        applyIcon(cell.icon, "cmdsword", iconTint);
        cell.icon.width = COMBAT_ICON_SIZE;
        cell.icon.height = COMBAT_ICON_SIZE;
        if (combatSubActive) {
          // Icon left, label right
          cell.icon.x = cx + (cellW - COMBAT_ICON_SIZE - cell.text.width - 3) / 2;
          cell.icon.y = y + (CELL_H - COMBAT_ICON_SIZE) / 2;
          cell.text.x = cell.icon.x + COMBAT_ICON_SIZE + 3 + cell.text.width / 2;
        } else {
          // Icon centered
          cell.icon.x = cx + (cellW - COMBAT_ICON_SIZE) / 2;
          cell.icon.y = y + (CELL_H - COMBAT_ICON_SIZE) / 2;
        }
      }

      // Trigger flash
      if (stepChanged && isActive) {
        cell.flashStart = performance.now();
      }

      // Hit area
      cell.hitArea.clear();
      cell.hitArea.rect(cx, y, cellW, CELL_H);
      cell.hitArea.fill({ color: 0x000000, alpha: 0.001 });

      cell.bg.clear();
      cell.bg.roundRect(cx, y, cellW, CELL_H, CELL_R);
      cell.bg.fill({ color: hexToNum(appTheme.secondary) });
      if (isActive) {
        cell.bg.roundRect(cx, y, cellW, CELL_H, CELL_R);
        cell.bg.stroke({ color: turnColor, width: 2, alignment: 0.5 });
      }

      cell.hoverBg.clear();

      // Text position (non-combat cells; combat text is positioned with the icon above)
      cell.text.style = isActive ? activeStyle : isEnabled ? enabledStyle : normalStyle;
      if (!isCombatCell) {
        cell.text.x = cx + cellW / 2;
        cell.text.y = y + CELL_H / 2;
      } else if (!combatSubActive) {
        // No text when showing icon only — position offscreen
        cell.text.x = -999;
      } else {
        cell.text.y = y + CELL_H / 2;
      }

      // ── Store indicator geometry for tick() drawing ──
      cell._indData = {
        cx: cx + cellW / 2,
        selfCy: y + CELL_H + INDICATOR_MARGIN + INDICATOR_SIZE / 2,
        oppCy: y - INDICATOR_MARGIN - INDICATOR_SIZE / 2,
        selfEnabled: phaseIds.some((ph) => state.selfEnabledPhases.has(ph)),
        selfColor,
        oppCount: state.opponents.length,
        oppEnabled: state.opponents.map((opp) => {
          const stops = state.opponentEnabledPhases.get(opp.id);
          return phaseIds.some((ph) => stops?.has(ph));
        }),
        oppColors,
        cellW,
        hideIndicators: false,
      };

      // Hit areas (static positions, always present)
      const indCx = cx + cellW / 2;
      const selfIndCy = y + CELL_H + INDICATOR_MARGIN + INDICATOR_SIZE / 2;
      cell.selfHitArea.clear();
      cell.selfHitArea.rect(
        indCx - INDICATOR_SIZE,
        selfIndCy - INDICATOR_SIZE,
        INDICATOR_SIZE * 2,
        INDICATOR_SIZE * 2,
      );
      cell.selfHitArea.fill({ color: 0x000000, alpha: 0.001 });

      const oppRowCy = y - INDICATOR_MARGIN - INDICATOR_SIZE / 2;
      const oppCount = state.opponents.length;
      const oppTotalW = oppCount * INDICATOR_SIZE + Math.max(0, oppCount - 1) * INDICATOR_GAP;
      const oppStartX = indCx - oppTotalW / 2 + INDICATOR_SIZE / 2;
      for (let oi = 0; oi < 3; oi++) {
        const oha = cell.oppHitAreas[oi]!;
        if (oi >= oppCount) {
          oha.visible = false;
          continue;
        }
        oha.visible = true;
        const shapeX = oppStartX + oi * (INDICATOR_SIZE + INDICATOR_GAP);
        oha.clear();
        oha.rect(
          shapeX - INDICATOR_SIZE,
          oppRowCy - INDICATOR_SIZE,
          INDICATOR_SIZE * 2,
          INDICATOR_SIZE * 2,
        );
        oha.fill({ color: 0x000000, alpha: 0.001 });
      }

      // Store geometry for flash tick
      cell._fx = cx;
      cell._fy = y;
      cell._fw = cellW;
      cell._fc = turnColor;
    }
  }

  tick(): void {
    // Draw indicators every frame
    for (let ci = 0; ci < this.cells.length; ci++) {
      const cell = this.cells[ci]!;
      const d = cell._indData;
      if (!d) continue;

      if (d.hideIndicators) {
        cell.selfIndicator.clear();
        cell.oppIndicators.clear();
        continue;
      }

      const cellHovered = this.hoveredCellIndex === ci;
      const showEmpty = cellHovered || cell.selfHovered || cell.oppHovered.some(Boolean);

      // Self indicator
      cell.selfIndicator.clear();
      if (d.selfEnabled || showEmpty) {
        const sz = cell.selfHovered ? INDICATOR_SIZE * 1.25 : INDICATOR_SIZE;
        drawShape(
          cell.selfIndicator,
          "circle",
          d.cx,
          d.selfCy,
          sz,
          d.selfColor,
          d.selfEnabled,
          false,
        );
      }

      // Opponent indicators
      cell.oppIndicators.clear();
      const oppTotalW = d.oppCount * INDICATOR_SIZE + Math.max(0, d.oppCount - 1) * INDICATOR_GAP;
      const oppStartX = d.cx - oppTotalW / 2 + INDICATOR_SIZE / 2;
      for (let oi = 0; oi < d.oppCount; oi++) {
        const enabled = d.oppEnabled[oi];
        if (!enabled && !showEmpty) continue;
        const color = d.oppColors[oi];
        const shapeX = oppStartX + oi * (INDICATOR_SIZE + INDICATOR_GAP);
        const sz = cell.oppHovered[oi] ? INDICATOR_SIZE * 1.25 : INDICATOR_SIZE;
        drawShape(cell.oppIndicators, "circle", shapeX, d.oppCy, sz, color, enabled, true);
      }
    }

    // Flash animation
    const now = performance.now();
    for (const cell of this.cells) {
      cell.flashGfx.clear();
      if (cell.flashStart === 0) continue;
      const elapsed = now - cell.flashStart;
      if (elapsed >= FLASH_DURATION_MS) {
        cell.flashStart = 0;
        continue;
      }

      const p = elapsed / FLASH_DURATION_MS;
      const e = easeOut(p);
      const fade = 1 - e;
      const cx = cell._fx;
      const cy = cell._fy;
      const color = cell._fc;
      if (cx === undefined || cy === undefined || color === undefined) continue;

      const cw = cell._fw ?? CELL_W;
      const expand = fade * FLASH_MAX_EXPAND;
      cell.flashGfx.roundRect(
        cx - expand,
        cy - expand,
        cw + expand * 2,
        CELL_H + expand * 2,
        CELL_R + expand * 0.5,
      );
      cell.flashGfx.stroke({ color, width: 1.5 + fade * 2, alpha: fade * 0.85, alignment: 0.5 });
      cell.flashGfx.roundRect(cx, cy, cw, CELL_H, CELL_R);
      cell.flashGfx.fill({ color, alpha: fade * fade * 0.25 });
    }
  }

  destroy(): void {
    try {
      this.container.destroy({ children: true });
    } catch {
      /* pixi teardown */
    }
  }
}

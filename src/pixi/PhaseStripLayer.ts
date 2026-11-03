import { UI_FONT_FAMILY as FONT } from "@/themes/typography";
import { BlurFilter, Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { readableTextColor } from "@/themes/gameTheme";
import { hexToNum, mixNum } from "./colorUtils";
import { isCoarsePointer } from "@/lib/responsive";
import { PHASE_BAR_ENTRIES, PHASES as STEP_DEFS } from "@/components/game/game.constants";
import { togglePhaseStops } from "@/components/game/game.utils";
import type { StepKind } from "@/protocol";
import { animationsEnabled } from "./effects/enabled";
import type { BlockingRect } from "./board/types";

export type PhaseStripStyle = "rail" | "hand" | "plate" | "drawer";

export interface PhaseDrawerOutline {
  base: BlockingRect | null;
  tower: BlockingRect;
  radius: number;
}

export interface PhaseStripFrame {
  field: BlockingRect;
  hand: BlockingRect | null;
  plate: BlockingRect | null;
  action: BlockingRect | null;
  gridBottom: number;
}

interface PhaseSpec {
  id: string;
  short: string;
  subPhases?: string[];
  labelPhase?: string;
}

const COMBAT_SUB_PHASES: string[] = STEP_DEFS.filter((p) => p.combat).map((p) => p.id);

const COMBAT_LABELS: Record<string, string> = Object.fromEntries(
  STEP_DEFS.filter((p) => p.combat).map((p) => [p.id, p.short]),
);

const PHASES: PhaseSpec[] = PHASE_BAR_ENTRIES.map((entry) =>
  entry.steps.length > 1
    ? {
        id: entry.id,
        short: entry.short,
        subPhases: [...entry.steps],
        labelPhase: "combatDeclareAttackers" satisfies StepKind,
      }
    : { id: entry.id, short: entry.short },
);

const STEP_ORDER = STEP_DEFS.filter((p) => p.id !== "untap");
const CLEANUP_STEP: StepKind = "cleanup";
const END_STEP: StepKind = "endOfTurn";

const CELL_R = 4;
const DRAWER_R = CELL_R * 1.5;

const RAIL_CELL_W = 56;
const RAIL_CELL_H = 24;
const RAIL_COMBAT_H = 34;
const RAIL_GAP = 4;
const RAIL_EDGE_PAD = 8;
const RAIL_ACTION_CLEARANCE = 160;
const RAIL_PANEL_PAD = 6;

const BAR_CELL_W = 40;
const BAR_COMBAT_W = 60;

const CENTER_CELL_W = 36;
const CENTER_EXPAND_W = 22;
const CENTER_H = 22;
const CENTER_HAND_GAP = 4;

const EXPANDED_GAP = 6;
const EXPANDED_PAD = 8;
const EXPANDED_ROW_LABEL_W = 14;
const EXPANDED_COL_W = 30;
const EXPANDED_GROUP_GAP = 6;
const EXPANDED_HEADER_H = 16;
const EXPANDED_ROW_H = 18;
const EXPANDED_TOGGLE_W = 14;
const EXPANDED_TOGGLE_H = 8;
const EXPANDED_SEAT_DOT_R = 4;

const DRAWER_INSET = 8;
const DRAWER_EASE = 0.3;
const DRAWER_HOVER_SLACK = 2;
const DRAWER_LICK_H = 14;
const DRAWER_PEEK = 12;
const DRAWER_SEGMENT_MIN_H = 8;
const DRAWER_SEGMENT_GAP = 3;
const DRAWER_RIM_W = 6;
const DRAWER_RIM_OPEN_W = 8;
const DRAWER_RIM_ZOOM_W = 13;
const DRAWER_RIM_HOVER_W = 15;
const DRAWER_RIM_HIT_OUT = 18;
const DRAWER_RIM_HIT_IN = 4;
const DRAWER_PULSE_MS = 1400;

const PLATE_MAX_H = 22;
const PLATE_MIN_H = 16;
const PLATE_GAP = 2;

const SURFACE_ALPHA = 0.94;
const BORDER_ALPHA = 0.5;
const DIVIDER_ALPHA = 0.35;
const SHADOW_ALPHA = 0.4;
const ACTIVE_FILL_ALPHA = 0.22;
const HOVER_FILL_ALPHA = 0.08;
const INACTIVE_TEXT_ALPHA = 0.72;
const PANEL_INDICATOR_H = 2;
const PANEL_INDICATOR_HOVER_H = 3;
const PANEL_INDICATOR_INSET = 4;

const COMBAT_PIP_W = 4;
const COMBAT_PIP_H = 4;
const COMBAT_PIP_ACTIVE_W = 10;
const COMBAT_PIP_GAP = 3;
const COMBAT_PIPS_W =
  (COMBAT_SUB_PHASES.length - 1) * (COMBAT_PIP_W + COMBAT_PIP_GAP) + COMBAT_PIP_ACTIVE_W;

const FLASH_DURATION_MS = 800;
const FLASH_MAX_EXPAND = 8;

const SWEEP_STEP_ORDER: string[] = STEP_DEFS.map((p) => p.id).filter((id) => id !== "untap");
const SWEEP_DWELL_MS = 10;
const SWEEP_TOTAL_MAX_MS = 150;

function easeOut(t: number): number {
  const t1 = 1 - t;
  return 1 - t1 * t1 * t1;
}

const INDICATOR_H = 4;
const INDICATOR_HOVER_H = 6;
const INDICATOR_GAP = 3;
const INDICATOR_MARGIN = 3;
const INDICATOR_HIT = 12;
const INDICATOR_GHOST_ALPHA = 0.35;
// My stops only fire on my turn — fade them while an opponent is acting.
const INDICATOR_OFF_TURN_ALPHA = 0.55;

const _initTheme = getTheme().gameTheme;
const _initForeground = readableTextColor(
  _initTheme.phaseStrip.background,
  _initTheme.canvas.shadow,
  _initTheme.textOnTinted,
);
const normalStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: "600",
  fill: _initForeground,
  align: "center",
});
const activeStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: "bold",
  fill: _initForeground,
  align: "center",
});
const drawerActiveStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: "bold",
  fill: _initForeground,
  align: "center",
});
const panelStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: "bold",
  fill: getTheme().appTheme.foreground,
  align: "center",
});
const headerStyle = new TextStyle({
  fontFamily: FONT,
  fontSize: 9,
  fontWeight: "bold",
  fill: getTheme().appTheme.foreground,
  align: "center",
});

interface Point2 {
  x: number;
  y: number;
}

interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CellGeometry {
  rect: CellRect;
  label: Point2;
  pips: Point2 | null;
  self: Point2[];
  selfHit: CellRect;
  opp: Point2[][];
  oppHit: CellRect[];
  hidden?: boolean;
  lifted?: boolean;
  peek?: boolean;
  rim?: boolean;
}

interface PhaseIndicatorData {
  rect: CellRect;
  rim?: boolean;
  self: Point2[];
  opp: Point2[][];
  selfEnabled: boolean;
  selfOffTurn: boolean;
  selfColor: number;
  oppEnabled: boolean[];
  oppColors: number[];
}

interface PhaseCell {
  bg: Graphics;
  flashGfx: Graphics;
  text: Text;
  pips: Graphics | null;
  id: string;
  defaultLabel: string;
  subPhases?: string[];
  labelPhase?: string;
  detailsHitArea: Graphics;
  flashStart: number;
  selfIndicator: Graphics;
  selfHitArea: Graphics;
  selfHovered: boolean;
  oppIndicators: Graphics;
  oppHitAreas: Graphics[];
  oppHovered: boolean[];
  zoom: number;
  indicators?: PhaseIndicatorData;
  flashRect?: CellRect;
  flashColor?: number;
}

export interface OpponentInfo {
  id: string;
  index: number;
}

export interface PhaseStripState {
  currentStep: string;
  isActiveTurn: boolean;
  activePlayerId: string;
  myPlayerId: string;
  selfEnabledPhases: Set<string>;
  opponentEnabledPhases: Map<string, Set<string>>;
  opponents: OpponentInfo[];
  isInteractive: boolean;
}

export interface PhaseStripCallbacks {
  onToggleSelfPhase?: (phaseId: string) => void;
  onToggleOpponentPhase?: (opponentId: string, phaseId: string) => void;
  onOpenPhaseDetails?: () => void;
}

function sameRect(a: BlockingRect | null, b: BlockingRect | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function copyRect(r: BlockingRect | null): BlockingRect | null {
  return r && { x: r.x, y: r.y, width: r.width, height: r.height };
}

function fillHit(g: Graphics, r: CellRect, color: number): void {
  g.clear();
  g.rect(r.x, r.y, r.w, r.h);
  g.fill({ color, alpha: 0.001 });
}

function strokeLine(g: Graphics, points: Point2[], width: number, color: number, alpha: number) {
  const [a, b] = points;
  if (!a || !b) return;
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke({ width, color, alpha, cap: "round" });
}

function plateWidth(): number {
  return (PHASES.length - 1) * BAR_CELL_W + BAR_COMBAT_W;
}

function centerWidth(): number {
  return (PHASES.length - 1) * CENTER_CELL_W + CENTER_EXPAND_W;
}

function contains(r: CellRect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export class PhaseStripLayer {
  readonly container: Container;
  private theme: Theme;
  private callbacks: PhaseStripCallbacks = {};
  private lastState: PhaseStripState | null = null;
  private cells: PhaseCell[];
  private panelShadow: Graphics;
  private panel: Graphics;
  private expandButton: Graphics;
  private expandHovered = false;
  private expandRect: CellRect | null = null;
  private expandedPanel: Container;
  private expandedRect: CellRect | null = null;
  private expanded = false;
  private prevStep: string | null = null;
  private prevIsActiveTurn = false;
  /** Displayed active player — lags behind the real one so the color
   *  doesn't flip during cleanup (engine advances the active player
   *  before the new turn's first phase). */
  private displayActivePlayerId: string | null = null;
  private style: PhaseStripStyle = "rail";
  private frame: PhaseStripFrame | null = null;
  private pointerInside = false;
  private dimAlpha = 1;
  private forceShowIndicators = false;
  private realState: PhaseStripState | null = null;
  private sweepQueue: { step: string; activePlayerId: string }[] = [];
  private sweepNextAt = 0;
  private sweepDwellMs = SWEEP_DWELL_MS;
  private drawerOffset = 0;
  private peekLift = 0;
  private railHovered = false;
  private hoveredRow = -1;
  private rimOpen = 0;
  private drawerHovered = false;
  private drawerHoverSuppressed = false;
  private drawerTab: CellRect | null = null;
  private drawerLick: CellRect | null = null;
  private lickShow = 0;
  private surfaceColor: number | null = null;

  constructor(theme: Theme) {
    this.theme = theme;
    this.container = new Container();
    this.container.label = "phaseStrip";
    this.container.eventMode = "static";
    this.container.on("pointerenter", () => {
      this.pointerInside = true;
    });
    this.container.on("pointerleave", () => {
      this.pointerInside = false;
    });

    this.panelShadow = new Graphics();
    this.panelShadow.alpha = SHADOW_ALPHA;
    this.panelShadow.filters = [new BlurFilter({ strength: 8 })];
    this.container.addChild(this.panelShadow);
    this.panel = new Graphics();
    this.container.addChild(this.panel);

    this.cells = [];
    for (const p of PHASES) {
      const isCombat = !!p.subPhases;
      const bg = new Graphics();
      this.container.addChild(bg);
      const flashGfx = new Graphics();
      this.container.addChild(flashGfx);
      const pips = isCombat ? new Graphics() : null;
      if (pips) this.container.addChild(pips);
      const text = new Text({ text: p.short, style: normalStyle });
      text.anchor.set(0.5, 0.5);
      this.container.addChild(text);

      const detailsHitArea = new Graphics();
      detailsHitArea.cursor = "pointer";
      detailsHitArea.on("pointerdown", () => {
        if (this.style === "drawer" && this.expanded) this.callbacks.onOpenPhaseDetails?.();
      });
      this.container.addChild(detailsHitArea);

      const selfIndicator = new Graphics();
      this.container.addChild(selfIndicator);
      const selfHitArea = new Graphics();
      selfHitArea.eventMode = "static";
      selfHitArea.cursor = "pointer";
      selfHitArea.on("pointerdown", () => {
        togglePhaseStops(p.subPhases ?? [p.id], this.lastState?.selfEnabledPhases, (ph) =>
          this.callbacks.onToggleSelfPhase?.(ph),
        );
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
      for (let oi = 0; oi < 3; oi++) {
        const oha = new Graphics();
        oha.eventMode = "static";
        oha.cursor = "pointer";
        oha.visible = false;
        oha.on("pointerdown", () => {
          const opp = this.lastState?.opponents[oi];
          if (!opp) return;
          togglePhaseStops(
            p.subPhases ?? [p.id],
            this.lastState?.opponentEnabledPhases.get(opp.id),
            (ph) => this.callbacks.onToggleOpponentPhase?.(opp.id, ph),
          );
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
        text,
        pips,
        id: p.id,
        defaultLabel: p.short,
        subPhases: p.subPhases,
        labelPhase: p.labelPhase,
        detailsHitArea,
        flashStart: 0,
        selfIndicator,
        selfHitArea,
        selfHovered: false,
        oppIndicators,
        oppHitAreas,
        oppHovered: [false, false, false],
        zoom: 0,
      };
      this.cells.push(cellRef);
    }

    this.expandButton = new Graphics();
    this.expandButton.eventMode = "static";
    this.expandButton.cursor = "pointer";
    this.expandButton.on("pointerdown", () => {
      if (this.expanded) {
        this.drawerHoverSuppressed = true;
        this.drawerHovered = false;
      }
      this.setExpanded(!this.expanded);
    });
    this.expandButton.on("pointerover", () => {
      this.expandHovered = true;
      this.refresh();
    });
    this.expandButton.on("pointerout", () => {
      this.expandHovered = false;
      this.refresh();
    });
    this.container.addChild(this.expandButton);

    this.expandedPanel = new Container();
    this.container.addChild(this.expandedPanel);
  }

  getDimAlpha(): number {
    return this.dimAlpha;
  }

  setDimAlpha(alpha: number): void {
    this.dimAlpha = alpha;
    this.container.alpha = alpha;
  }

  setStyle(style: PhaseStripStyle): void {
    if (this.style === style) return;
    this.style = style;
    this.expanded = false;
    this.drawerOffset = 0;
    this.peekLift = 0;
    this.lickShow = 0;
    this.refresh();
  }

  setSurfaceColor(color: number | null): void {
    if (this.surfaceColor === color) return;
    this.surfaceColor = color;
    this.refresh();
  }

  setFrame(frame: PhaseStripFrame | null): void {
    const prev = this.frame;
    if (
      prev?.gridBottom === frame?.gridBottom &&
      sameRect(prev?.field ?? null, frame?.field ?? null) &&
      sameRect(prev?.hand ?? null, frame?.hand ?? null) &&
      sameRect(prev?.plate ?? null, frame?.plate ?? null) &&
      sameRect(prev?.action ?? null, frame?.action ?? null)
    ) {
      return;
    }
    this.frame = frame && {
      field: copyRect(frame.field)!,
      hand: copyRect(frame.hand),
      plate: copyRect(frame.plate),
      action: copyRect(frame.action),
      gridBottom: frame.gridBottom,
    };
    this.refresh();
  }

  handleOutsidePointerDown(x: number, y: number): void {
    if (!this.expanded || this.style === "drawer") return;
    if (this.expandedRect && contains(this.expandedRect, x, y)) return;
    if (this.expandRect && contains(this.expandRect, x, y)) return;
    this.setExpanded(false);
  }

  handlePointerMove(x: number, y: number): void {
    const action = this.frame?.action;
    if (this.style !== "drawer" || !action) {
      this.drawerHovered = false;
      this.railHovered = false;
      this.hoveredRow = -1;
      return;
    }
    const panel = this.drawerPanelRect();
    const top =
      Math.min(panel.y, this.drawerTab?.y ?? panel.y, this.drawerLick?.y ?? panel.y) -
      DRAWER_HOVER_SLACK;
    const strip = {
      x: panel.x - DRAWER_HOVER_SLACK,
      y: top,
      w: panel.w + DRAWER_HOVER_SLACK * 2,
      h: action.y - top + DRAWER_HOVER_SLACK,
    };
    const onTab =
      (!!this.drawerTab && contains(this.drawerTab, x, y)) ||
      (!!this.drawerLick && contains(this.drawerLick, x, y));
    const over =
      onTab || ((this.drawerHovered || this.drawerHoverSuppressed) && contains(strip, x, y));
    if (!over) this.drawerHoverSuppressed = false;
    this.drawerHovered = over && !this.drawerHoverSuppressed;
    this.railHovered =
      y >= panel.y &&
      y <= action.y &&
      x >= panel.x - DRAWER_RIM_HIT_OUT &&
      x <= panel.x + panel.w + DRAWER_RIM_HIT_OUT;
    this.hoveredRow = this.railHovered
      ? this.cells.findIndex((cell) => {
          const r = cell.indicators?.rim ? cell.indicators.rect : null;
          return !!r && y >= r.y - RAIL_GAP / 2 && y <= r.y + r.h + RAIL_GAP / 2;
        })
      : -1;
  }

  getDrawerOutline(): PhaseDrawerOutline | null {
    const action = this.frame?.action;
    const top = this.drawerLick ?? this.drawerTab;
    if (this.style !== "drawer" || !action || !top || !this.container.visible) return null;
    const panel = this.drawerPanelRect();
    return {
      base:
        action.y - panel.y >= 1
          ? { x: panel.x, y: panel.y, width: panel.w, height: action.y - panel.y }
          : null,
      tower: { x: top.x, y: top.y, width: top.w, height: action.y - top.y },
      radius: DRAWER_R,
    };
  }

  getBounds(): BlockingRect | null {
    if (!this.container.visible || !this.frame || this.style !== "rail") return null;
    const panel = this.railPanelRect(this.lastState?.opponents.length ?? 0);
    return {
      x: panel.x,
      y: panel.y,
      width: this.frame.field.x + this.frame.field.width - panel.x,
      height: panel.h,
    };
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    const foreground = readableTextColor(
      theme.gameTheme.phaseStrip.background,
      theme.gameTheme.canvas.shadow,
      theme.gameTheme.textOnTinted,
    );
    normalStyle.fill = foreground;
    activeStyle.fill = foreground;
    panelStyle.fill = theme.appTheme.foreground;
    headerStyle.fill = theme.appTheme.foreground;
    this.refresh();
  }

  setCallbacks(cb: PhaseStripCallbacks): void {
    this.callbacks = cb;
  }

  update(state: PhaseStripState): void {
    const displayed = this.lastState;
    this.realState = state;
    if (!animationsEnabled()) {
      this.sweepQueue = [];
      this.render(state);
      return;
    }
    if (!displayed) {
      this.render(state);
      return;
    }
    const from = SWEEP_STEP_ORDER.indexOf(displayed.currentStep);
    const to = SWEEP_STEP_ORDER.indexOf(state.currentStep);
    const turnChanged = displayed.activePlayerId !== state.activePlayerId;
    // Backward jumps within the same player's turn are snapshot restores or
    // extra-phase oddities, not elapsed time — never sweep through a turn
    // boundary for them.
    if (from < 0 || to < 0 || (to <= from && !turnChanged)) {
      this.sweepQueue = [];
      this.render(state);
      return;
    }
    const len = SWEEP_STEP_ORDER.length;
    let travel = (to - from + len) % len;
    // Landing on the same phase of the next player's turn is a full ring loop.
    if (travel === 0 && turnChanged) travel = len;
    if (travel <= 1) {
      this.sweepQueue = [];
      this.render(state);
      return;
    }
    const queue: { step: string; activePlayerId: string }[] = [];
    for (let k = 1; k <= travel; k++) {
      const inOldTurn = turnChanged && from + k < len;
      queue.push({
        step: SWEEP_STEP_ORDER[(from + k) % len]!,
        activePlayerId: inOldTurn ? displayed.activePlayerId : state.activePlayerId,
      });
    }
    this.sweepQueue = queue;
    this.sweepDwellMs = Math.min(SWEEP_DWELL_MS, SWEEP_TOTAL_MAX_MS / travel);
    this.sweepNextAt = 0;
  }

  private refresh(): void {
    if (this.lastState) this.render(this.lastState);
  }

  private setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.refresh();
  }

  private railColumns(oppCount: number): { cellX: number; selfX: number; oppX: number[] } {
    const field = this.frame!.field;
    const oppW = oppCount * INDICATOR_H + Math.max(0, oppCount - 1) * INDICATOR_GAP;
    const right = field.x + field.width - RAIL_EDGE_PAD;
    const cellX = right - oppW - (oppCount ? INDICATOR_MARGIN : 0) - RAIL_CELL_W;
    const oppX = Array.from(
      { length: oppCount },
      (_, i) =>
        cellX +
        RAIL_CELL_W +
        INDICATOR_MARGIN +
        INDICATOR_H / 2 +
        i * (INDICATOR_H + INDICATOR_GAP),
    );
    return { cellX, selfX: cellX - INDICATOR_MARGIN - INDICATOR_H / 2, oppX };
  }

  private railHeight(): number {
    let total = 0;
    for (const cell of this.cells) total += cell.subPhases ? RAIL_COMBAT_H : RAIL_CELL_H;
    return total + RAIL_GAP * (this.cells.length - 1);
  }

  private railTop(): number {
    const field = this.frame!.field;
    const bottom = field.y + field.height - RAIL_ACTION_CLEARANCE;
    return Math.max(field.y + RAIL_EDGE_PAD, bottom - this.railHeight());
  }

  private railPanelRect(oppCount: number): CellRect {
    const { cellX, selfX, oppX } = this.railColumns(oppCount);
    const left = selfX - INDICATOR_H / 2 - RAIL_PANEL_PAD;
    const lastOpp = oppX[oppX.length - 1];
    const right =
      (lastOpp === undefined ? cellX + RAIL_CELL_W : lastOpp + INDICATOR_H / 2) + RAIL_PANEL_PAD;
    const top = this.railTop() - RAIL_PANEL_PAD;
    return { x: left, y: top, w: right - left, h: this.railHeight() + RAIL_PANEL_PAD * 2 };
  }

  private railGeometry(oppCount: number): CellGeometry[] {
    const { cellX, selfX, oppX } = this.railColumns(oppCount);
    const oppHitW = INDICATOR_H + INDICATOR_GAP;
    let y = this.railTop();
    return this.cells.map((cell) => {
      const h = cell.subPhases ? RAIL_COMBAT_H : RAIL_CELL_H;
      const top = y;
      y += h + RAIL_GAP;
      const lineTop = top + INDICATOR_H / 2;
      const lineBottom = top + h - INDICATOR_H / 2;
      return {
        rect: { x: cellX, y: top, w: RAIL_CELL_W, h },
        label: { x: cellX + RAIL_CELL_W / 2, y: cell.subPhases ? top + 12 : top + h / 2 },
        pips: cell.subPhases
          ? { x: cellX + (RAIL_CELL_W - COMBAT_PIPS_W) / 2, y: top + h - 10 }
          : null,
        self: [
          { x: selfX, y: lineTop },
          { x: selfX, y: lineBottom },
        ],
        selfHit: { x: selfX - INDICATOR_HIT / 2, y: top, w: INDICATOR_HIT, h },
        opp: oppX.map((x) => [
          { x, y: lineTop },
          { x, y: lineBottom },
        ]),
        oppHit: oppX.map((x) => ({ x: x - oppHitW / 2, y: top, w: oppHitW, h })),
      };
    });
  }

  private drawerOpponents(): number {
    return this.lastState?.opponents.length ?? 0;
  }

  private drawerCellHeight(cell: PhaseCell, oppCount: number): number {
    const base = cell.subPhases ? RAIL_COMBAT_H : RAIL_CELL_H;
    const segments = oppCount * DRAWER_SEGMENT_MIN_H + (oppCount - 1) * DRAWER_SEGMENT_GAP;
    return Math.max(base, segments);
  }

  private drawerFullHeight(): number {
    const oppCount = this.drawerOpponents();
    let total = RAIL_GAP * (this.cells.length - 1) + RAIL_PANEL_PAD * 2;
    for (const cell of this.cells) total += this.drawerCellHeight(cell, oppCount);
    return total;
  }

  private drawerPanelRect(): CellRect {
    const action = this.frame!.action!;
    const w = RAIL_PANEL_PAD * 2 + RAIL_CELL_W;
    return {
      x: action.x + action.width - DRAWER_INSET - w,
      y: action.y - this.drawerOffset,
      w,
      h: this.drawerFullHeight(),
    };
  }

  private drawerGeometry(step: string): CellGeometry[] {
    const action = this.frame!.action!;
    const panel = this.drawerPanelRect();
    const oppCount = this.drawerOpponents();
    const selfX = panel.x;
    const oppX = panel.x + panel.w;
    const cellX = panel.x + RAIL_PANEL_PAD;
    const opponents = Array.from({ length: oppCount }, (_, i) => i);
    let y = panel.y + RAIL_PANEL_PAD;
    const slots = this.cells.map((cell) => {
      const h = this.drawerCellHeight(cell, oppCount);
      const top = y;
      y += h + RAIL_GAP;
      return { top, h };
    });
    const currentIndex = this.cells.findIndex((cell) => this.isCurrent(cell, step));
    const current = slots[currentIndex];
    const lift = this.peekLift * (RAIL_GAP + DRAWER_PEEK);
    const lickTop = current ? action.y - RAIL_PANEL_PAD - current.h - lift : 0;
    const lifted = !!current && lickTop < current.top;
    return this.cells.map((cell, i) => {
      const { h } = slots[i]!;
      const isLifted = lifted && i === currentIndex;
      const isPeek = lifted && i === currentIndex + 1;
      const top = isLifted
        ? lickTop
        : isPeek
          ? lickTop + current!.h + RAIL_PANEL_PAD
          : slots[i]!.top;
      const shared = {
        rect: { x: cellX, y: top, w: RAIL_CELL_W, h },
        label: { x: cellX + RAIL_CELL_W / 2, y: cell.subPhases ? top + 12 : top + h / 2 },
        pips: cell.subPhases
          ? { x: cellX + (RAIL_CELL_W - COMBAT_PIPS_W) / 2, y: top + h - 10 }
          : null,
      };
      if (isLifted || isPeek) {
        return {
          ...shared,
          self: [],
          selfHit: { x: 0, y: 0, w: 0, h: 0 },
          opp: [],
          oppHit: [],
          lifted: isLifted,
          peek: isPeek,
          hidden: top >= action.y,
        };
      }
      const segment = (h - (oppCount - 1) * DRAWER_SEGMENT_GAP) / Math.max(1, oppCount);
      const band = h / Math.max(1, oppCount);
      return {
        ...shared,
        self: [
          { x: selfX, y: top },
          { x: selfX, y: top + h },
        ],
        selfHit: {
          x: selfX - DRAWER_RIM_HIT_OUT,
          y: top,
          w: DRAWER_RIM_HIT_OUT + DRAWER_RIM_HIT_IN,
          h,
        },
        opp: opponents.map((i) => {
          const start = top + i * (segment + DRAWER_SEGMENT_GAP);
          return [
            { x: oppX, y: start },
            { x: oppX, y: start + segment },
          ];
        }),
        oppHit: opponents.map((i) => ({
          x: oppX - DRAWER_RIM_HIT_IN,
          y: top + i * band,
          w: DRAWER_RIM_HIT_OUT + DRAWER_RIM_HIT_IN,
          h: band,
        })),
        rim: true,
        hidden: top >= action.y,
      };
    });
  }

  private centerBarRect(): CellRect | null {
    const hand = this.frame?.hand;
    if (!hand) return null;
    const w = centerWidth();
    return {
      x: hand.x + hand.width / 2 - w / 2,
      y: hand.y - CENTER_HAND_GAP - CENTER_H,
      w,
      h: CENTER_H,
    };
  }

  private centerGeometry(): CellGeometry[] | null {
    const bar = this.centerBarRect();
    if (!bar) return null;
    const selfY = bar.y + bar.h - 1 - PANEL_INDICATOR_HOVER_H / 2;
    let x = bar.x;
    return this.cells.map((cell) => {
      if (cell.id === CLEANUP_STEP) {
        return {
          rect: { x: 0, y: 0, w: 0, h: 0 },
          label: { x: 0, y: 0 },
          pips: null,
          self: [],
          selfHit: { x: 0, y: 0, w: 0, h: 0 },
          opp: [],
          oppHit: [],
          hidden: true,
        };
      }
      const left = x;
      x += CENTER_CELL_W;
      const rect = { x: left, y: bar.y, w: CENTER_CELL_W, h: bar.h };
      return {
        rect,
        label: { x: left + CENTER_CELL_W / 2, y: bar.y + bar.h / 2 },
        pips: null,
        self: [
          { x: left + PANEL_INDICATOR_INSET, y: selfY },
          { x: left + CENTER_CELL_W - PANEL_INDICATOR_INSET, y: selfY },
        ],
        selfHit: rect,
        opp: [],
        oppHit: [],
      };
    });
  }

  private plateBarRect(): CellRect | null {
    const frame = this.frame;
    if (!frame?.plate) return null;
    const bottom = frame.plate.y - PLATE_GAP;
    const h = Math.min(PLATE_MAX_H, Math.max(PLATE_MIN_H, bottom - frame.gridBottom));
    return { x: frame.plate.x, y: bottom - h, w: plateWidth(), h };
  }

  private plateGeometry(oppCount: number): CellGeometry[] | null {
    const bar = this.plateBarRect();
    if (!bar) return null;
    const half = bar.h / 2;
    const selfY = bar.y + bar.h - 1 - PANEL_INDICATOR_HOVER_H / 2;
    const oppY = bar.y + 1 + PANEL_INDICATOR_HOVER_H / 2;
    let x = bar.x;
    return this.cells.map((cell) => {
      const w = cell.subPhases ? BAR_COMBAT_W : BAR_CELL_W;
      const left = x;
      x += w;
      const segW = (w - INDICATOR_GAP * Math.max(0, oppCount - 1)) / Math.max(1, oppCount);
      const segX = (i: number) => left + i * (segW + INDICATOR_GAP);
      return {
        rect: { x: left, y: bar.y, w, h: bar.h },
        label: { x: left + w / 2, y: bar.y + half },
        pips: null,
        self: [
          { x: left + PANEL_INDICATOR_INSET, y: selfY },
          { x: left + w - PANEL_INDICATOR_INSET, y: selfY },
        ],
        selfHit: { x: left, y: bar.y + half, w, h: half },
        opp: Array.from({ length: oppCount }, (_, i) => [
          { x: segX(i) + PANEL_INDICATOR_INSET, y: oppY },
          { x: segX(i) + segW - PANEL_INDICATOR_INSET, y: oppY },
        ]),
        oppHit: Array.from({ length: oppCount }, (_, i) => ({
          x: segX(i),
          y: bar.y,
          w: segW,
          h: half,
        })),
      };
    });
  }

  private isCurrent(cell: PhaseCell, step: string): boolean {
    if (this.style === "hand" && step === CLEANUP_STEP) return cell.id === END_STEP;
    return cell.subPhases ? cell.subPhases.includes(step) : step === cell.id;
  }

  private render(state: PhaseStripState): void {
    this.lastState = state;
    const t = this.theme.gameTheme;
    const app = this.theme.appTheme;
    const foreground = readableTextColor(t.phaseStrip.background, t.canvas.shadow, t.textOnTinted);
    this.forceShowIndicators = isCoarsePointer();

    const pc = t.playerColors;
    const selfColor = hexToNum(pc.self);
    const oppColors = [hexToNum(pc.opponent1), hexToNum(pc.opponent2), hexToNum(pc.opponent3)];

    // Only update the displayed active player on non-cleanup phases
    // so the color doesn't flip early during cleanup.
    if (state.currentStep !== "cleanup") {
      this.displayActivePlayerId = state.activePlayerId;
    }
    const displayActive = this.displayActivePlayerId ?? state.activePlayerId;
    const isMeActive = displayActive === state.myPlayerId;
    const activeOppIdx = state.opponents.findIndex((o) => o.id === displayActive);
    const turnHex = isMeActive
      ? pc.self
      : activeOppIdx >= 0
        ? [pc.opponent1, pc.opponent2, pc.opponent3][activeOppIdx]!
        : t.textMuted;
    const turnColor = hexToNum(turnHex);
    const activeInk = readableTextColor(turnHex, t.canvas.shadow, t.textOnTinted);
    drawerActiveStyle.fill = activeInk;

    const turnJustStarted = state.isActiveTurn && !this.prevIsActiveTurn;
    this.prevIsActiveTurn = state.isActiveTurn;
    let stepChanged = false;
    if (turnJustStarted) {
      this.prevStep = state.currentStep;
    } else if (this.prevStep !== null && this.prevStep !== state.currentStep) {
      stepChanged = true;
    }
    this.prevStep = state.currentStep;

    const oppCount = state.opponents.length;
    const center = this.style === "hand";
    const drawer = this.style === "drawer";
    const railLike = this.style === "rail" || drawer;
    const panelStyled = !railLike;
    const action = this.frame?.action ?? null;
    const geometry =
      !this.frame || (drawer && !action)
        ? null
        : drawer
          ? this.drawerGeometry(state.currentStep)
          : railLike
            ? this.railGeometry(oppCount)
            : center
              ? this.centerGeometry()
              : this.plateGeometry(oppCount);

    this.panel.clear();
    this.panelShadow.clear();
    this.expandButton.clear();
    this.expandRect = null;
    this.drawerTab = null;
    this.drawerLick = null;
    this.container.renderable = geometry !== null;
    if (!geometry) {
      this.renderExpanded(null, state, selfColor, oppColors, turnColor);
      this.container.hitArea = new Rectangle(0, 0, 0, 0);
      return;
    }

    const neutral = hexToNum(t.canvas.neutral);
    const surface = hexToNum(t.phaseStrip.background);
    const drawerSurface = this.surfaceColor ?? hexToNum(app.card);
    const border = hexToNum(app.border);
    const panelBar = center ? this.centerBarRect() : panelStyled ? this.plateBarRect() : null;
    const railPanel = drawer
      ? this.drawerPanelRect()
      : railLike
        ? this.railPanelRect(oppCount)
        : null;
    if (railPanel && action && drawer) railPanel.h = Math.max(0, action.y - railPanel.y + DRAWER_R);
    if (panelBar) {
      this.panelShadow
        .roundRect(panelBar.x, panelBar.y + 2, panelBar.w, panelBar.h, CELL_R)
        .fill({ color: hexToNum(t.canvas.shadow) });
      this.panel
        .roundRect(panelBar.x, panelBar.y, panelBar.w, panelBar.h, CELL_R)
        .fill({ color: hexToNum(app.card), alpha: SURFACE_ALPHA })
        .stroke({ color: border, width: 1, alpha: BORDER_ALPHA });
    } else if (railPanel && railPanel.h > 0) {
      const r = railPanel;
      this.panelShadow
        .roundRect(r.x, r.y + 2, r.w, r.h, DRAWER_R)
        .fill({ color: hexToNum(t.canvas.shadow) });
      this.panel
        .roundRect(r.x, r.y, r.w, r.h, DRAWER_R)
        .fill({ color: drawer ? drawerSurface : hexToNum(app.card) })
        .stroke({ color: border, width: 1, alpha: BORDER_ALPHA });
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const include = (r: CellRect) => {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    };

    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]!;
      const geo = geometry[i]!;
      const { rect } = geo;

      if (geo.hidden) {
        cell.bg.clear();
        cell.pips?.clear();
        cell.text.visible = false;
        cell.selfHitArea.clear();
        cell.detailsHitArea.clear();
        cell.selfIndicator.clear();
        cell.oppIndicators.clear();
        for (const oha of cell.oppHitAreas) oha.visible = false;
        cell.indicators = undefined;
        cell.flashRect = undefined;
        continue;
      }

      const isActive = this.isCurrent(cell, state.currentStep);
      const phaseIds = cell.subPhases ?? [cell.id];

      if (panelBar && rect.x > panelBar.x) {
        this.panel.moveTo(rect.x, rect.y + 4).lineTo(rect.x, rect.y + rect.h - 4);
      }

      cell.text.text =
        cell.subPhases && isActive
          ? (COMBAT_LABELS[state.currentStep] ?? cell.defaultLabel)
          : center && cell.subPhases
            ? (COMBAT_LABELS[cell.labelPhase!] ?? cell.defaultLabel)
            : cell.defaultLabel;
      cell.text.style = panelStyled
        ? panelStyle
        : drawer && isActive
          ? drawerActiveStyle
          : isActive
            ? activeStyle
            : normalStyle;
      cell.text.alpha = panelStyled && !isActive ? INACTIVE_TEXT_ALPHA : 1;
      cell.text.position.set(geo.label.x, geo.label.y);
      cell.text.visible = true;

      if (cell.pips) {
        cell.pips.clear();
        if (geo.pips) {
          const currentIdx = isActive ? COMBAT_SUB_PHASES.indexOf(state.currentStep) : -1;
          let px = geo.pips.x;
          for (let pi = 0; pi < COMBAT_SUB_PHASES.length; pi++) {
            const activePip = pi === currentIdx;
            const pipW = activePip ? COMBAT_PIP_ACTIVE_W : COMBAT_PIP_W;
            cell.pips.roundRect(px, geo.pips.y, pipW, COMBAT_PIP_H, COMBAT_PIP_H / 2);
            const ink = drawer && isActive ? hexToNum(activeInk) : hexToNum(foreground);
            cell.pips.fill({
              color: activePip ? (drawer && isActive ? ink : turnColor) : ink,
              alpha: activePip ? 1 : INDICATOR_GHOST_ALPHA,
            });
            px += pipW + COMBAT_PIP_GAP;
          }
        }
      }

      if (stepChanged && isActive && animationsEnabled()) {
        cell.flashStart = performance.now();
      }

      const radius = Math.min(CELL_R, rect.h / 2);
      cell.bg.clear();
      const opensDetails = drawer && this.expanded && !geo.lifted && !geo.peek;
      cell.detailsHitArea.eventMode = opensDetails ? "static" : "none";
      if (opensDetails) fillHit(cell.detailsHitArea, rect, neutral);
      else cell.detailsHitArea.clear();
      if (drawer && railPanel && action) {
        if (geo.lifted) {
          const tab = {
            x: railPanel.x,
            y: rect.y - RAIL_PANEL_PAD,
            w: railPanel.w,
            h: action.y - rect.y + RAIL_PANEL_PAD,
          };
          this.drawerTab = tab;
          cell.bg.roundRect(tab.x, tab.y, tab.w, tab.h + DRAWER_R, DRAWER_R);
          cell.bg.fill({ color: drawerSurface });
        }
        cell.bg.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
        cell.bg.fill({ color: isActive ? turnColor : surface });
      } else if (!panelStyled) {
        cell.bg.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
        cell.bg.fill({ color: surface });
      }
      if (isActive && !drawer) {
        if (panelStyled) {
          cell.bg.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
          cell.bg.fill({ color: turnColor, alpha: ACTIVE_FILL_ALPHA });
        }
        cell.bg.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
        cell.bg.stroke({ color: turnColor, width: 2, alignment: panelStyled ? 1 : 0.5 });
      }

      fillHit(cell.selfHitArea, geo.selfHit, neutral);
      include(rect);
      include(geo.selfHit);
      for (let oi = 0; oi < cell.oppHitAreas.length; oi++) {
        const oha = cell.oppHitAreas[oi]!;
        const hit = geo.oppHit[oi];
        oha.visible = !!hit;
        if (!hit) continue;
        fillHit(oha, hit, neutral);
        include(hit);
      }

      cell.indicators = {
        rect,
        rim: geo.rim,
        self: geo.self,
        opp: geo.opp,
        selfEnabled: phaseIds.some((ph) => state.selfEnabledPhases.has(ph)),
        selfOffTurn: !isMeActive,
        selfColor,
        oppEnabled: state.opponents.map((opp) => {
          const stops = state.opponentEnabledPhases.get(opp.id);
          return phaseIds.some((ph) => stops?.has(ph));
        }),
        oppColors,
      };
      cell.flashRect = rect;
      cell.flashColor = turnColor;
    }

    if (panelBar) {
      if (center) {
        const r = {
          x: panelBar.x + panelBar.w - CENTER_EXPAND_W,
          y: panelBar.y,
          w: CENTER_EXPAND_W,
          h: panelBar.h,
        };
        this.panel.moveTo(r.x, r.y + 4).lineTo(r.x, r.y + r.h - 4);
        this.drawExpandButton(r);
      }
      this.panel.stroke({ color: border, width: 1, alpha: DIVIDER_ALPHA });
    }

    const expandedRect = this.renderExpanded(
      center && this.expanded ? panelBar : null,
      state,
      selfColor,
      oppColors,
      turnColor,
    );
    if (expandedRect) include(expandedRect);
    if (railPanel && railPanel.h > 0) include(railPanel);
    if (this.drawerTab) include(this.drawerTab);
    if (drawer && action && railPanel) {
      const top = Math.min(railPanel.y, this.drawerTab?.y ?? railPanel.y, action.y);
      const base = this.drawerTab ?? railPanel;
      const lickH = DRAWER_LICK_H * this.lickShow;
      if (lickH >= 1) {
        const lick = { x: base.x, y: top - lickH, w: base.w, h: lickH };
        this.drawDrawerLick(lick);
        include(lick);
      }
      const tab = this.drawerTab;
      if (tab && !this.expanded) {
        this.expandButton.rect(tab.x, tab.y, tab.w, tab.h).fill({ color: neutral, alpha: 0.001 });
      }
    }
    this.container.hitArea = new Rectangle(minX, minY, maxX - minX, maxY - minY);
  }

  private drawDrawerLick(r: CellRect): void {
    this.drawerLick = r;
    const app = this.theme.appTheme;
    const fg = hexToNum(app.foreground);
    const bottom = r.y + r.h + DRAWER_R;
    const g = this.expandButton;
    const outline = () =>
      g
        .moveTo(r.x, bottom)
        .lineTo(r.x, r.y + DRAWER_R)
        .quadraticCurveTo(r.x, r.y, r.x + DRAWER_R, r.y)
        .lineTo(r.x + r.w - DRAWER_R, r.y)
        .quadraticCurveTo(r.x + r.w, r.y, r.x + r.w, r.y + DRAWER_R)
        .lineTo(r.x + r.w, bottom);
    outline()
      .closePath()
      .fill({ color: this.surfaceColor ?? hexToNum(app.card) });
    outline().stroke({ color: hexToNum(app.border), width: 1, alpha: BORDER_ALPHA });
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2 + 1;
    const s = 4;
    if (this.expanded) {
      g.poly([cx - s, cy - s / 2, cx + s, cy - s / 2, cx, cy + s / 2]);
    } else {
      g.poly([cx - s, cy + s / 2, cx + s, cy + s / 2, cx, cy - s / 2]);
    }
    g.fill({
      color: fg,
      alpha: (this.expandHovered ? 1 : INACTIVE_TEXT_ALPHA) * this.lickShow,
    });
  }

  private drawExpandButton(r: CellRect): void {
    this.expandRect = r;
    const fg = hexToNum(this.theme.appTheme.foreground);
    const g = this.expandButton;
    g.rect(r.x, r.y, r.w, r.h).fill({
      color: fg,
      alpha: this.expandHovered || this.expanded ? HOVER_FILL_ALPHA : 0.001,
    });
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const s = 4;
    if (this.expanded) {
      g.poly([cx - s, cy + s / 2, cx + s, cy + s / 2, cx, cy - s / 2]);
    } else {
      g.poly([cx - s, cy - s / 2, cx + s, cy - s / 2, cx, cy + s / 2]);
    }
    g.fill({ color: fg, alpha: this.expanded ? 1 : INACTIVE_TEXT_ALPHA });
  }

  private renderExpanded(
    bar: CellRect | null,
    state: PhaseStripState,
    selfColor: number,
    oppColors: number[],
    turnColor: number,
  ): CellRect | null {
    for (const child of this.expandedPanel.removeChildren()) child.destroy({ children: true });
    this.expandedRect = null;
    if (!bar) return null;

    const app = this.theme.appTheme;
    const t = this.theme.gameTheme;
    const combatStart = SWEEP_STEP_ORDER.indexOf(COMBAT_SUB_PHASES[0]!);
    const groupOf = (id: string) =>
      COMBAT_SUB_PHASES.includes(id) ? 1 : SWEEP_STEP_ORDER.indexOf(id) < combatStart ? 0 : 2;
    const columns: { id: string; short: string; x: number }[] = [];
    let x = EXPANDED_PAD + EXPANDED_ROW_LABEL_W;
    let group = 0;
    for (const step of STEP_ORDER) {
      const g = groupOf(step.id);
      if (g !== group) {
        x += EXPANDED_GROUP_GAP;
        group = g;
      }
      columns.push({ id: step.id, short: step.short, x });
      x += EXPANDED_COL_W;
    }
    const rows = [
      { color: selfColor, stops: state.selfEnabledPhases, opponentId: null as string | null },
      ...state.opponents.map((opp, i) => ({
        color: oppColors[i]!,
        stops: state.opponentEnabledPhases.get(opp.id) ?? new Set<string>(),
        opponentId: opp.id as string | null,
      })),
    ];
    const w = x + EXPANDED_PAD;
    const h = EXPANDED_PAD * 2 + EXPANDED_HEADER_H + rows.length * EXPANDED_ROW_H;
    const rect = {
      x: bar.x + bar.w / 2 - w / 2,
      y: bar.y - EXPANDED_GAP - h,
      w,
      h,
    };
    this.expandedRect = rect;

    const shadow = new Graphics()
      .roundRect(rect.x, rect.y + 3, w, h, CELL_R * 1.5)
      .fill({ color: hexToNum(t.canvas.shadow) });
    shadow.alpha = SHADOW_ALPHA;
    shadow.filters = [new BlurFilter({ strength: 10 })];
    const surface = new Graphics()
      .roundRect(rect.x, rect.y, w, h, CELL_R * 1.5)
      .fill({ color: hexToNum(app.card), alpha: SURFACE_ALPHA })
      .stroke({ color: hexToNum(app.border), width: 1, alpha: BORDER_ALPHA });
    surface.eventMode = "static";
    this.expandedPanel.addChild(shadow, surface);

    const headerY = rect.y + EXPANDED_PAD + EXPANDED_HEADER_H / 2;
    for (const col of columns) {
      const cx = rect.x + col.x + EXPANDED_COL_W / 2;
      const current = state.currentStep === col.id;
      if (current) {
        surface
          .roundRect(
            rect.x + col.x + 1,
            rect.y + EXPANDED_PAD - 2,
            EXPANDED_COL_W - 2,
            h - EXPANDED_PAD * 2 + 4,
            CELL_R,
          )
          .fill({ color: turnColor, alpha: ACTIVE_FILL_ALPHA });
      }
      const label = new Text({ text: col.short, style: headerStyle });
      label.anchor.set(0.5, 0.5);
      label.position.set(cx, headerY);
      label.alpha = current ? 1 : INACTIVE_TEXT_ALPHA;
      this.expandedPanel.addChild(label);
    }

    rows.forEach((row, ri) => {
      const cy =
        rect.y + EXPANDED_PAD + EXPANDED_HEADER_H + ri * EXPANDED_ROW_H + EXPANDED_ROW_H / 2;
      surface
        .circle(rect.x + EXPANDED_PAD + EXPANDED_ROW_LABEL_W / 2 - 2, cy, EXPANDED_SEAT_DOT_R)
        .fill({ color: row.color });
      for (const col of columns) {
        const enabled = row.stops.has(col.id);
        const cx = rect.x + col.x + EXPANDED_COL_W / 2;
        const toggle = new Graphics();
        toggle
          .rect(cx - EXPANDED_COL_W / 2, cy - EXPANDED_ROW_H / 2, EXPANDED_COL_W, EXPANDED_ROW_H)
          .fill({ color: hexToNum(t.canvas.neutral), alpha: 0.001 });
        toggle.roundRect(
          cx - EXPANDED_TOGGLE_W / 2,
          cy - EXPANDED_TOGGLE_H / 2,
          EXPANDED_TOGGLE_W,
          EXPANDED_TOGGLE_H,
          EXPANDED_TOGGLE_H / 2,
        );
        if (enabled) toggle.fill({ color: row.color });
        else toggle.stroke({ color: row.color, width: 1, alpha: INDICATOR_GHOST_ALPHA * 1.5 });
        toggle.eventMode = "static";
        toggle.cursor = "pointer";
        toggle.on("pointerdown", () => {
          if (row.opponentId) this.callbacks.onToggleOpponentPhase?.(row.opponentId, col.id);
          else this.callbacks.onToggleSelfPhase?.(col.id);
        });
        this.expandedPanel.addChild(toggle);
      }
    });
    return rect;
  }

  private drawIndicators(): void {
    const panelStyled = this.style !== "rail" && this.style !== "drawer";
    const center = this.style === "hand";
    const lineH = panelStyled ? PANEL_INDICATOR_H : INDICATOR_H;
    const hoverH = panelStyled ? PANEL_INDICATOR_HOVER_H : INDICATOR_HOVER_H;
    const showAllEmpty = !center && (this.forceShowIndicators || this.pointerInside);
    const fg = hexToNum(this.theme.appTheme.foreground);
    for (const cell of this.cells) {
      const d = cell.indicators;
      if (!d) continue;
      if (d.rim) {
        this.drawRimBars(cell, d);
        continue;
      }

      cell.selfIndicator.clear();
      if (center && cell.selfHovered) {
        cell.selfIndicator
          .rect(d.rect.x, d.rect.y, d.rect.w, d.rect.h)
          .fill({ color: fg, alpha: HOVER_FILL_ALPHA });
      }
      if (d.selfEnabled || showAllEmpty || (center && cell.selfHovered)) {
        strokeLine(
          cell.selfIndicator,
          d.self,
          cell.selfHovered && !center ? hoverH : lineH,
          d.selfColor,
          d.selfEnabled ? (d.selfOffTurn ? INDICATOR_OFF_TURN_ALPHA : 1) : INDICATOR_GHOST_ALPHA,
        );
      }

      cell.oppIndicators.clear();
      for (let oi = 0; oi < d.opp.length; oi++) {
        const enabled = d.oppEnabled[oi];
        if (!enabled && !showAllEmpty) continue;
        strokeLine(
          cell.oppIndicators,
          d.opp[oi]!,
          cell.oppHovered[oi] ? hoverH : lineH,
          d.oppColors[oi]!,
          enabled ? 1 : INDICATOR_GHOST_ALPHA,
        );
      }
    }
  }

  private drawRimBars(cell: PhaseCell, d: PhaseIndicatorData): void {
    const open = this.rimOpen;
    const zoom = cell.zoom;
    const outline = hexToNum(this.theme.gameTheme.canvas.shadow);
    const light = hexToNum(this.theme.gameTheme.textOnTinted);
    const pulse = animationsEnabled()
      ? (1 - Math.cos((performance.now() / DRAWER_PULSE_MS) * Math.PI * 2)) / 2
      : 0.5;
    const glow = open * pulse;
    const bar = (
      g: Graphics,
      points: Point2[],
      side: -1 | 1,
      hovered: boolean,
      enabled: boolean,
      color: number,
    ) => {
      const [a, b] = points;
      if (!a || !b || (!enabled && open < 0.01)) return;
      const w = hovered
        ? DRAWER_RIM_HOVER_W
        : DRAWER_RIM_W +
          (DRAWER_RIM_OPEN_W - DRAWER_RIM_W) * open +
          (DRAWER_RIM_ZOOM_W - DRAWER_RIM_OPEN_W) * zoom;
      const x = side < 0 ? a.x - w + 1 : a.x - 1;
      if (enabled) {
        const inner = side < 0 ? x + w : x;
        const outer = side < 0 ? x : x + w;
        g.rect(x, a.y, w, b.y - a.y).fill({ color: mixNum(color, light, 0.8 * glow) });
        if (!this.railHovered) return;
        g.moveTo(inner, a.y)
          .lineTo(outer, a.y)
          .lineTo(outer, b.y)
          .lineTo(inner, b.y)
          .stroke({ color: light, width: 1 });
      } else {
        g.roundRect(x, a.y, w, b.y - a.y, Math.min(2, w / 2))
          .fill({ color: outline })
          .stroke({ color, width: 1.5, alignment: 1 });
      }
    };
    cell.selfIndicator.clear();
    bar(cell.selfIndicator, d.self, -1, cell.selfHovered, d.selfEnabled, d.selfColor);
    cell.oppIndicators.clear();
    for (let oi = 0; oi < d.opp.length; oi++) {
      bar(
        cell.oppIndicators,
        d.opp[oi]!,
        1,
        !!cell.oppHovered[oi],
        !!d.oppEnabled[oi],
        d.oppColors[oi]!,
      );
    }
  }

  tick(): void {
    if (this.style === "drawer") {
      const ease = (value: number, target: number) => {
        const next = value + (target - value) * DRAWER_EASE;
        return !animationsEnabled() || Math.abs(target - next) < 0.5 ? target : next;
      };
      const easeUnit = (value: number, target: number) =>
        !animationsEnabled() || Math.abs(target - value) < 0.01
          ? target
          : value + (target - value) * DRAWER_EASE;
      const offsetTarget = this.expanded ? this.drawerFullHeight() : 0;
      const liftTarget = this.drawerHovered && !this.expanded ? 1 : 0;
      const lickTarget = this.expanded || this.drawerHovered ? 1 : 0;
      if (
        this.drawerOffset !== offsetTarget ||
        this.peekLift !== liftTarget ||
        this.lickShow !== lickTarget
      ) {
        this.drawerOffset = ease(this.drawerOffset, offsetTarget);
        this.peekLift = easeUnit(this.peekLift, liftTarget);
        this.lickShow = easeUnit(this.lickShow, lickTarget);
        this.refresh();
      }
      this.rimOpen = easeUnit(this.rimOpen, this.railHovered ? 1 : 0);
      this.cells.forEach((cell, i) => {
        cell.zoom = easeUnit(cell.zoom, i === this.hoveredRow ? 1 : 0);
      });
    }
    if (!animationsEnabled() && this.sweepQueue.length && this.realState) {
      this.sweepQueue = [];
      this.render(this.realState);
    }
    if (this.sweepQueue.length > 0 && this.realState) {
      const sweepNow = performance.now();
      if (sweepNow >= this.sweepNextAt) {
        const entry = this.sweepQueue.shift()!;
        this.sweepNextAt = sweepNow + this.sweepDwellMs;
        this.render({
          ...this.realState,
          currentStep: entry.step,
          activePlayerId: entry.activePlayerId,
          isActiveTurn: entry.activePlayerId === this.realState.myPlayerId,
        });
      }
    }

    this.drawIndicators();

    const now = performance.now();
    if (!animationsEnabled()) {
      for (const cell of this.cells) {
        cell.flashStart = 0;
        cell.flashGfx.clear();
      }
      return;
    }
    for (const cell of this.cells) {
      cell.flashGfx.clear();
      if (cell.flashStart === 0) continue;
      const elapsed = now - cell.flashStart;
      if (elapsed >= FLASH_DURATION_MS) {
        cell.flashStart = 0;
        continue;
      }
      const r = cell.flashRect;
      const color = cell.flashColor;
      if (!r || color === undefined) continue;
      const fade = 1 - easeOut(elapsed / FLASH_DURATION_MS);
      const expand = fade * FLASH_MAX_EXPAND;
      const radius = Math.min(CELL_R, r.h / 2);
      cell.flashGfx.roundRect(
        r.x - expand,
        r.y - expand,
        r.w + expand * 2,
        r.h + expand * 2,
        radius + expand * 0.5,
      );
      cell.flashGfx.stroke({ color, width: 1.5 + fade * 2, alpha: fade * 0.85, alignment: 0.5 });
      cell.flashGfx.roundRect(r.x, r.y, r.w, r.h, radius);
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

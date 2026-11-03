import { UI_FONT_FAMILY as FONT } from "@/themes/typography";
import { BlurFilter, Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { readableTextColor } from "@/themes/gameTheme";
import { hexToNum, mixNum } from "./colorUtils";
import { PHASE_BAR_ENTRIES, PHASES as STEP_DEFS } from "@/components/game/game.constants";
import { togglePhaseStops } from "@/components/game/game.utils";
import { animationsEnabled } from "./effects/enabled";
import type { BlockingRect } from "./board/types";

export interface PhaseDrawerOutline {
  base: BlockingRect | null;
  tower: BlockingRect;
  radius: number;
}

interface PhaseSpec {
  id: string;
  short: string;
  subPhases?: string[];
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
      }
    : { id: entry.id, short: entry.short },
);

const CELL_R = 4;
const DRAWER_R = CELL_R * 1.5;

const RAIL_CELL_W = 56;
const RAIL_CELL_H = 24;
const RAIL_COMBAT_H = 34;
const RAIL_GAP = 4;
const RAIL_PANEL_PAD = 6;

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

const BORDER_ALPHA = 0.5;
const SHADOW_ALPHA = 0.4;
const INACTIVE_TEXT_ALPHA = 0.72;

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

const INDICATOR_GHOST_ALPHA = 0.35;

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
  private expanded = false;
  private prevStep: string | null = null;
  private prevIsActiveTurn = false;
  /** Displayed active player — lags behind the real one so the color
   *  doesn't flip during cleanup (engine advances the active player
   *  before the new turn's first phase). */
  private displayActivePlayerId: string | null = null;
  private action: BlockingRect | null = null;
  private dimAlpha = 1;
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
        if (this.expanded) this.callbacks.onOpenPhaseDetails?.();
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
  }

  getDimAlpha(): number {
    return this.dimAlpha;
  }

  setDimAlpha(alpha: number): void {
    this.dimAlpha = alpha;
    this.container.alpha = alpha;
  }

  setSurfaceColor(color: number | null): void {
    if (this.surfaceColor === color) return;
    this.surfaceColor = color;
    this.refresh();
  }

  setAction(action: BlockingRect | null): void {
    if (sameRect(this.action, action)) return;
    this.action = copyRect(action);
    this.refresh();
  }

  handlePointerMove(x: number, y: number): void {
    const action = this.action;
    if (!action) {
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
    const action = this.action;
    const top = this.drawerLick ?? this.drawerTab;
    if (!action || !top || !this.container.visible) return null;
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

  setTheme(theme: Theme): void {
    this.theme = theme;
    const foreground = readableTextColor(
      theme.gameTheme.phaseStrip.background,
      theme.gameTheme.canvas.shadow,
      theme.gameTheme.textOnTinted,
    );
    normalStyle.fill = foreground;
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
    const action = this.action!;
    const w = RAIL_PANEL_PAD * 2 + RAIL_CELL_W;
    return {
      x: action.x + action.width - DRAWER_INSET - w,
      y: action.y - this.drawerOffset,
      w,
      h: this.drawerFullHeight(),
    };
  }

  private drawerGeometry(step: string): CellGeometry[] {
    const action = this.action!;
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

  private isCurrent(cell: PhaseCell, step: string): boolean {
    return cell.subPhases ? cell.subPhases.includes(step) : step === cell.id;
  }

  private render(state: PhaseStripState): void {
    this.lastState = state;
    const t = this.theme.gameTheme;
    const app = this.theme.appTheme;
    const foreground = readableTextColor(t.phaseStrip.background, t.canvas.shadow, t.textOnTinted);

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
    activeStyle.fill = activeInk;

    const turnJustStarted = state.isActiveTurn && !this.prevIsActiveTurn;
    this.prevIsActiveTurn = state.isActiveTurn;
    let stepChanged = false;
    if (turnJustStarted) {
      this.prevStep = state.currentStep;
    } else if (this.prevStep !== null && this.prevStep !== state.currentStep) {
      stepChanged = true;
    }
    this.prevStep = state.currentStep;

    const action = this.action;

    this.panel.clear();
    this.panelShadow.clear();
    this.expandButton.clear();
    this.drawerTab = null;
    this.drawerLick = null;
    this.container.renderable = action !== null;
    if (!action) {
      this.container.hitArea = new Rectangle(0, 0, 0, 0);
      return;
    }
    const geometry = this.drawerGeometry(state.currentStep);

    const neutral = hexToNum(t.canvas.neutral);
    const surface = hexToNum(t.phaseStrip.background);
    const drawerSurface = this.surfaceColor ?? hexToNum(app.card);
    const border = hexToNum(app.border);
    const railPanel = this.drawerPanelRect();
    railPanel.h = Math.max(0, action.y - railPanel.y + DRAWER_R);
    if (railPanel.h > 0) {
      const r = railPanel;
      this.panelShadow
        .roundRect(r.x, r.y + 2, r.w, r.h, DRAWER_R)
        .fill({ color: hexToNum(t.canvas.shadow) });
      this.panel
        .roundRect(r.x, r.y, r.w, r.h, DRAWER_R)
        .fill({ color: drawerSurface })
        .stroke({ color: border, width: 1, alpha: BORDER_ALPHA });
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const include = (r: CellRect) => {
      if (r.w <= 0 || r.h <= 0) return;
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

      cell.text.text =
        cell.subPhases && isActive
          ? (COMBAT_LABELS[state.currentStep] ?? cell.defaultLabel)
          : cell.defaultLabel;
      cell.text.style = isActive ? activeStyle : normalStyle;
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
            cell.pips.fill({
              color: hexToNum(isActive ? activeInk : foreground),
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
      const opensDetails = this.expanded && !geo.lifted && !geo.peek;
      cell.detailsHitArea.eventMode = opensDetails ? "static" : "none";
      if (opensDetails) fillHit(cell.detailsHitArea, rect, neutral);
      else cell.detailsHitArea.clear();
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

    include(railPanel);
    if (this.drawerTab) include(this.drawerTab);
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

  private drawIndicators(): void {
    for (const cell of this.cells) {
      const d = cell.indicators;
      if (!d) continue;
      if (d.rim) {
        this.drawRimBars(cell, d);
      } else {
        cell.selfIndicator.clear();
        cell.oppIndicators.clear();
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

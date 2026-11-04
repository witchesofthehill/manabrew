import { Container, Graphics, Text } from "pixi.js";
import { PHASE_BAR_ENTRIES } from "@/components/game/game.constants";
import { togglePhaseStops } from "@/components/game/game.utils";
import type { Theme } from "@/hooks/useTheme";
import { readableTextColor } from "@/themes/gameTheme";
import { UI_FONT_FAMILY } from "@/themes/typography";
import type { BlockingRect } from "../board/types";
import { hexToNum, mixNum } from "../colorUtils";
import { animationsEnabled } from "../effects/enabled";
import type { PhaseDrawerOutline, PhaseStripCallbacks, PhaseStripState } from "../PhaseStripLayer";

const CELL_W = 34;
const COMBAT_CELL_W = 56;
const CELL_H = 24;
const CELL_GAP = 2;
const PAD = 4;
const BORDER = 2;
const PLATE_GAP = 2;
const OUTER_GAP = 4;
const TURN_BAR_ID = "turn";
const TURN_BAR_MIN_MARGIN = 8;
const REVEAL_EASE = 0.3;
const HOVER_SLACK = 2;
const RADIUS = 6;

const cellWidth = (steps: readonly string[]) => (steps.length > 1 ? COMBAT_CELL_W : CELL_W);

const BAR_W =
  PAD * 2 +
  PHASE_BAR_ENTRIES.reduce((total, entry) => total + cellWidth(entry.steps), 0) +
  CELL_GAP * (PHASE_BAR_ENTRIES.length - 1);
const BAR_H = PAD * 2 + CELL_H;
const BAR_TRAVEL = OUTER_GAP + BAR_H + PLATE_GAP;
export const PLAYER_PANEL_WIDTH = BAR_W;
export const PLAYER_PANEL_EDGE_GAP = 12;

interface BarCell {
  entry: (typeof PHASE_BAR_ENTRIES)[number];
  x: number;
  width: number;
  shape: Graphics;
  label: Text;
}

interface PlayerBar {
  id: string;
  container: Container;
  panel: Graphics;
  seatHex: string;
  cells: BarCell[];
  hovered: number;
  panelHovered: boolean;
  open: number;
  shift: number;
  bounds: { x: number; y: number; w: number; h: number } | null;
}

export class PlayerPhaseBars {
  readonly container = new Container();
  private theme: Theme;
  private callbacks: PhaseStripCallbacks = {};
  private state: PhaseStripState | null = null;
  private displayActivePlayerId: string | null = null;
  private bars = new Map<string, PlayerBar>();
  private onShift: ((playerId: string, dy: number) => void) | null = null;
  private turnSurface: number | null = null;
  private turnOutline: PhaseDrawerOutline | null = null;

  constructor(theme: Theme) {
    this.theme = theme;
    this.container.label = "playerPhaseBars";
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    if (this.state) this.setState(this.state);
  }

  setShiftHandler(onShift: (playerId: string, dy: number) => void): void {
    this.onShift = onShift;
  }

  setCallbacks(callbacks: PhaseStripCallbacks): void {
    this.callbacks = callbacks;
  }

  setState(state: PhaseStripState): void {
    this.state = state;
    if (state.currentStep !== "cleanup") this.displayActivePlayerId = state.activePlayerId;
    const pc = this.theme.gameTheme.playerColors;
    const seats = [
      { id: state.myPlayerId, seatHex: pc.self },
      ...state.opponents.map((opponent) => ({
        id: opponent.id,
        seatHex: [pc.opponent1, pc.opponent2, pc.opponent3][opponent.index] ?? pc.opponent1,
      })),
    ];
    const activeId = this.displayActivePlayerId ?? state.activePlayerId;
    const activeHex = seats.find((seat) => seat.id === activeId)?.seatHex ?? pc.self;
    seats.push({ id: TURN_BAR_ID, seatHex: activeHex });
    const seen = new Set(seats.map((seat) => seat.id));
    for (const [id, bar] of this.bars) {
      if (seen.has(id)) continue;
      bar.container.destroy({ children: true });
      this.bars.delete(id);
    }
    for (const seat of seats) {
      const bar = this.bars.get(seat.id) ?? this.createBar(seat.id);
      bar.seatHex = seat.seatHex;
    }
    this.drawAll();
  }

  setFrame(playerId: string, plate: BlockingRect | null, field: BlockingRect | null): void {
    const bar = this.bars.get(playerId);
    if (!bar) return;
    const visible = !!plate && !!field && plate.x + BAR_W <= field.x + field.width;
    const local = playerId === this.state?.myPlayerId;
    const travel = visible ? bar.open * BAR_TRAVEL : 0;
    const shift = local ? -travel : travel;
    if (bar.shift !== shift) {
      bar.shift = shift;
      this.onShift?.(playerId, shift);
    }
    if (!plate || !visible) {
      bar.container.visible = false;
      bar.bounds = null;
      return;
    }
    const plateBottom = plate.y + plate.height;
    const hiddenBy = BAR_TRAVEL - travel;
    const barY = local
      ? plateBottom - OUTER_GAP - BAR_H + hiddenBy
      : plate.y + OUTER_GAP - hiddenBy;
    bar.container.visible = travel > 0.5;
    bar.container.position.set(plate.x, barY);
    bar.bounds = {
      x: plate.x,
      y: local ? plate.y - travel : plate.y,
      w: BAR_W,
      h: plate.height + travel,
    };
  }

  setTurnFrame(action: BlockingRect | null): void {
    const bar = this.bars.get(TURN_BAR_ID);
    if (!bar) return;
    const fits = !!action && action.width >= BAR_W + TURN_BAR_MIN_MARGIN * 2;
    bar.container.visible = fits;
    if (!action || !fits) {
      this.turnOutline = null;
      return;
    }
    const x = action.x + (action.width - BAR_W) / 2;
    const y = action.y - BAR_H;
    bar.container.position.set(x, y);
    this.turnOutline = {
      base: null,
      tower: { x, y, width: BAR_W, height: BAR_H },
      radius: RADIUS,
    };
  }

  setTurnSurface(color: number | null): void {
    if (this.turnSurface === color) return;
    this.turnSurface = color;
    const bar = this.bars.get(TURN_BAR_ID);
    if (bar) this.draw(bar);
  }

  getTurnOutline(): PhaseDrawerOutline | null {
    return this.turnOutline;
  }

  private ownerOf(barId: string): string {
    return barId === TURN_BAR_ID
      ? (this.displayActivePlayerId ?? this.state?.activePlayerId ?? barId)
      : barId;
  }

  handlePointerMove(x: number, y: number): void {
    for (const bar of this.bars.values()) {
      const b = bar.bounds;
      const over =
        !!b &&
        x >= b.x - HOVER_SLACK &&
        x <= b.x + b.w + HOVER_SLACK &&
        y >= b.y - HOVER_SLACK &&
        y <= b.y + b.h + HOVER_SLACK;
      if (bar.panelHovered === over) continue;
      bar.panelHovered = over;
    }
  }

  tick(): void {
    for (const bar of this.bars.values()) {
      const target = bar.panelHovered ? 1 : 0;
      const next = bar.open + (target - bar.open) * REVEAL_EASE;
      bar.open = !animationsEnabled() || Math.abs(target - next) < 0.01 ? target : next;
    }
  }

  private stopsOf(playerId: string): ReadonlySet<string> | undefined {
    const state = this.state;
    return playerId === state?.myPlayerId
      ? state.selfEnabledPhases
      : state?.opponentEnabledPhases.get(playerId);
  }

  private toggleStop(playerId: string, step: string): void {
    if (playerId === this.state?.myPlayerId) this.callbacks.onToggleSelfPhase?.(step);
    else this.callbacks.onToggleOpponentPhase?.(playerId, step);
  }

  private createBar(id: string): PlayerBar {
    const container = new Container();
    container.visible = false;
    const panel = new Graphics();
    container.addChild(panel);
    const bar: PlayerBar = {
      id,
      container,
      panel,
      seatHex: "",
      cells: [],
      hovered: -1,
      panelHovered: false,
      open: 0,
      shift: 0,
      bounds: null,
    };
    let x = PAD;
    PHASE_BAR_ENTRIES.forEach((entry, index) => {
      const width = cellWidth(entry.steps);
      const shape = new Graphics();
      const label = new Text({
        text: entry.short,
        style: { fontFamily: UI_FONT_FAMILY, fontSize: 11, fontWeight: "bold" },
      });
      label.anchor.set(0.5);
      label.position.set(x + width / 2, PAD + CELL_H / 2);
      const hit = new Graphics()
        .rect(x - CELL_GAP / 2, 0, width + CELL_GAP, BAR_H)
        .fill({ color: hexToNum(this.theme.gameTheme.canvas.neutral), alpha: 0.001 });
      hit.eventMode = "static";
      hit.cursor = "pointer";
      hit.on("pointerdown", () => {
        const owner = this.ownerOf(id);
        togglePhaseStops(entry.steps, this.stopsOf(owner), (step) => this.toggleStop(owner, step));
      });
      hit.on("pointerover", () => {
        bar.hovered = index;
        this.draw(bar);
      });
      hit.on("pointerout", () => {
        if (bar.hovered === index) bar.hovered = -1;
        this.draw(bar);
      });
      container.addChild(shape, label, hit);
      bar.cells.push({ entry, x, width, shape, label });
      x += width + CELL_GAP;
    });
    this.container.addChild(container);
    this.bars.set(id, bar);
    return bar;
  }

  private drawAll(): void {
    for (const bar of this.bars.values()) this.draw(bar);
  }

  private draw(bar: PlayerBar): void {
    const state = this.state;
    if (!state) return;
    const { gameTheme: t, appTheme: app } = this.theme;
    const surfaceHex = t.phaseStrip.background;
    const surfaceInk = readableTextColor(surfaceHex, t.canvas.shadow, t.textOnTinted);
    const setInk = readableTextColor(t.textOnTinted, t.canvas.shadow, t.textOnTinted);
    const turnBar = bar.id === TURN_BAR_ID;
    const onTurn = turnBar || (this.displayActivePlayerId ?? state.activePlayerId) === bar.id;
    const stops = this.stopsOf(this.ownerOf(bar.id));
    const inset = BORDER / 2;
    bar.panel.clear();
    if (turnBar) {
      bar.panel
        .roundRect(0, 0, BAR_W, BAR_H + RADIUS, RADIUS)
        .fill({ color: this.turnSurface ?? hexToNum(app.card) });
    } else {
      bar.panel
        .roundRect(inset, inset, BAR_W - BORDER, BAR_H - BORDER, RADIUS)
        .fill({ color: hexToNum(app.card) })
        .stroke({ color: hexToNum(bar.seatHex), width: BORDER });
    }
    const surface = hexToNum(surfaceHex);
    const light = hexToNum(t.textOnTinted);
    const seat = hexToNum(bar.seatHex);
    const seatInk = readableTextColor(bar.seatHex, t.canvas.shadow, t.textOnTinted);
    bar.cells.forEach((cell, index) => {
      const { entry, x, width, shape, label } = cell;
      const current = onTurn && entry.steps.some((step) => step === state.currentStep);
      const enabled = entry.steps.some((step) => stops?.has(step));
      const hovered = bar.hovered === index;
      const fill = enabled
        ? hovered
          ? mixNum(light, surface, 0.2)
          : light
        : hovered
          ? mixNum(surface, light, 0.25)
          : surface;
      shape
        .clear()
        .roundRect(x, PAD, width, CELL_H, 3)
        .fill({ color: current ? seat : fill });
      if (current && enabled) shape.stroke({ color: light, width: 2, alignment: 1 });
      label.style.fill = current ? seatInk : enabled ? setInk : surfaceInk;
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.bars.clear();
  }
}

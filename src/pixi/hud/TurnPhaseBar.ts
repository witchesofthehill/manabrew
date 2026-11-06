import { Container, Graphics, Text } from "pixi.js";
import { PHASE_BAR_ENTRIES, PHASES } from "@/components/game/game.constants";
import { togglePhaseStops } from "@/components/game/game.utils";
import type { Theme } from "@/hooks/useTheme";
import { readableTextColor } from "@/themes/gameTheme";
import { UI_FONT_FAMILY } from "@/themes/typography";
import type { BlockingRect } from "../board/types";
import { hexToNum, mixNum } from "../colorUtils";
import { animationsEnabled } from "../effects/enabled";
import type { PhaseDrawerOutline, PhaseStripCallbacks, PhaseStripState } from "../PhaseStripLayer";

const PAD = 4;
const CELL_H = 24;
const CELL_GAP = 2;
const COMBAT_CELL_SPAN = 1.7;
const BAR_H = PAD * 2 + CELL_H;
const LICK_H = 22;
const STOPS_BUTTON_W = 24;
const STOPS_ICON_HALF = 6;
const STOPS_ICON_ARM = 3;
const MIN_WIDTH = 260;
const RADIUS = 6;
const REVEAL_EASE = 0.3;
const HOVER_SLACK = 2;
const LICK_SWAP_AT = 0.5;
const CELLS_ACTIVE_AT = 0.9;

interface Cell {
  entry: (typeof PHASE_BAR_ENTRIES)[number];
  x: number;
  width: number;
  shape: Graphics;
  label: Text;
  hit: Graphics;
}

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

export class TurnPhaseBar {
  readonly container = new Container();
  private readonly clip = new Graphics();
  private readonly body = new Container();
  private readonly panel = new Graphics();
  private readonly cellLayer = new Container();
  private readonly lickFill = new Graphics();
  private readonly lickLabel = new Text({
    text: "",
    style: { fontFamily: UI_FONT_FAMILY, fontSize: 11, fontWeight: "bold" },
  });
  private readonly cells: Cell[];
  private readonly stopsButton = new Graphics();
  private readonly stopsHit = new Graphics();
  private stopsX = 0;
  private stopsHovered = false;
  private theme: Theme;
  private callbacks: PhaseStripCallbacks = {};
  private state: PhaseStripState | null = null;
  private activeId: string | null = null;
  private action: BlockingRect | null = null;
  private surface: number | null = null;
  private outline: PhaseDrawerOutline | null = null;
  private width = 0;
  private open = 0;
  private currentIndex = 0;
  private lickLeft = 0;
  private lickRight = 0;
  private clipKey = "";
  private hovered = false;
  private hoveredCell = -1;

  constructor(theme: Theme) {
    this.theme = theme;
    this.container.label = "turnPhaseBar";
    this.container.visible = false;
    this.lickLabel.anchor.set(0.5);
    this.body.addChild(this.panel, this.cellLayer, this.lickFill, this.lickLabel);
    this.body.mask = this.clip;
    this.container.addChild(this.clip, this.body);
    this.cells = PHASE_BAR_ENTRIES.map((entry, index) => this.createCell(entry, index));
    this.stopsHit.eventMode = "static";
    this.stopsHit.cursor = "pointer";
    this.stopsHit.on("pointerdown", () => this.callbacks.onOpenPhaseDetails?.());
    this.stopsHit.on("pointerover", () => {
      this.stopsHovered = true;
      this.draw();
    });
    this.stopsHit.on("pointerout", () => {
      this.stopsHovered = false;
      this.draw();
    });
    this.cellLayer.addChild(this.stopsButton, this.stopsHit);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.draw();
  }

  setCallbacks(callbacks: PhaseStripCallbacks): void {
    this.callbacks = callbacks;
  }

  setState(state: PhaseStripState): void {
    this.state = state;
    if (state.currentStep !== "cleanup") this.activeId = state.activePlayerId;
    const index = PHASE_BAR_ENTRIES.findIndex((entry) =>
      entry.steps.some((step) => step === state.currentStep),
    );
    if (index >= 0) this.currentIndex = index;
    this.draw();
  }

  setFrame(action: BlockingRect | null): void {
    const fits = !!action && action.width >= MIN_WIDTH;
    this.action = fits ? action : null;
    this.container.visible = fits;
    if (!action || !fits) {
      this.outline = null;
      return;
    }
    if (this.width !== action.width) {
      this.width = action.width;
      this.layoutCells();
      const lick = this.lickTarget();
      this.lickLeft = lick.left;
      this.lickRight = lick.right;
      this.draw();
    }
    this.applyOpen();
  }

  setSurface(color: number | null): void {
    if (this.surface === color) return;
    this.surface = color;
    this.draw();
  }

  getOutline(): PhaseDrawerOutline | null {
    return this.outline;
  }

  handlePointerMove(x: number, y: number): void {
    const tower = this.outline?.tower;
    this.hovered =
      !!tower &&
      x >= tower.x - HOVER_SLACK &&
      x <= tower.x + tower.width + HOVER_SLACK &&
      y >= tower.y - HOVER_SLACK &&
      y <= tower.y + tower.height + HOVER_SLACK;
  }

  tick(): void {
    const lick = this.lickTarget();
    this.open = this.ease(this.open, this.hovered ? 1 : 0);
    this.lickLeft = this.ease(this.lickLeft, lick.left);
    this.lickRight = this.ease(this.lickRight, lick.right);
  }

  private ease(value: number, target: number): number {
    const next = value + (target - value) * REVEAL_EASE;
    return !animationsEnabled() || Math.abs(target - next) < 0.01 ? target : next;
  }

  private lickTarget(): { left: number; right: number } {
    const cell = this.cells[this.currentIndex]!;
    return { left: this.currentIndex === 0 ? 0 : cell.x, right: cell.x + cell.width };
  }

  private applyOpen(): void {
    const action = this.action!;
    const left = lerp(this.lickLeft, 0, this.open);
    const width = lerp(this.lickRight - this.lickLeft, action.width, this.open);
    const height = lerp(LICK_H, BAR_H, this.open);
    const top = BAR_H - height;
    this.container.position.set(action.x, action.y - BAR_H);
    const clipKey = `${left}:${width}:${height}`;
    if (clipKey !== this.clipKey) {
      this.clipKey = clipKey;
      this.clip
        .clear()
        .roundRect(left, top, width, height + RADIUS * 2, RADIUS)
        .fill({ color: hexToNum(this.theme.gameTheme.canvas.neutral) });
    }
    const lickVisible = this.open < LICK_SWAP_AT;
    this.lickFill.visible = lickVisible;
    this.lickLabel.visible = lickVisible;
    this.lickLabel.position.set(left + width / 2, top + height / 2);
    this.cellLayer.interactiveChildren = this.open > CELLS_ACTIVE_AT;
    this.outline = {
      base: null,
      tower: { x: action.x + left, y: action.y - height, width, height },
      radius: RADIUS,
    };
  }

  private activeHex(): string {
    const { state, theme } = this;
    const pc = theme.gameTheme.playerColors;
    const opponent = state?.opponents.find((seat) => seat.id === this.activeId);
    if (!opponent) return pc.self;
    return [pc.opponent1, pc.opponent2, pc.opponent3][opponent.index] ?? pc.opponent1;
  }

  private stops(): ReadonlySet<string> | undefined {
    const state = this.state;
    return this.activeId === state?.myPlayerId
      ? state?.selfEnabledPhases
      : state?.opponentEnabledPhases.get(this.activeId ?? "");
  }

  private toggleStops(entry: Cell["entry"]): void {
    const id = this.activeId;
    if (!id) return;
    togglePhaseStops(entry.steps, this.stops(), (step) => {
      if (id === this.state?.myPlayerId) this.callbacks.onToggleSelfPhase?.(step);
      else this.callbacks.onToggleOpponentPhase?.(id, step);
    });
  }

  private createCell(entry: Cell["entry"], index: number): Cell {
    const shape = new Graphics();
    const label = new Text({
      text: entry.short,
      style: { fontFamily: UI_FONT_FAMILY, fontSize: 11, fontWeight: "bold" },
    });
    label.anchor.set(0.5);
    const hit = new Graphics();
    hit.eventMode = "static";
    hit.cursor = "pointer";
    hit.on("pointerdown", () => this.toggleStops(entry));
    hit.on("pointerover", () => {
      this.hoveredCell = index;
      this.draw();
    });
    hit.on("pointerout", () => {
      if (this.hoveredCell === index) this.hoveredCell = -1;
      this.draw();
    });
    this.cellLayer.addChild(shape, label, hit);
    return { entry, x: 0, width: 0, shape, label, hit };
  }

  private layoutCells(): void {
    const room = this.width - PAD * 2 - CELL_GAP * this.cells.length - STOPS_BUTTON_W;
    const narrow = Math.floor(room / (this.cells.length - 1 + COMBAT_CELL_SPAN));
    const wide = room - narrow * (this.cells.length - 1);
    const neutral = hexToNum(this.theme.gameTheme.canvas.neutral);
    let x = PAD;
    for (const cell of this.cells) {
      cell.x = x;
      cell.width = cell.entry.steps.length > 1 ? wide : narrow;
      cell.label.position.set(x + cell.width / 2, PAD + CELL_H / 2);
      cell.hit
        .clear()
        .rect(x - CELL_GAP / 2, 0, cell.width + CELL_GAP, BAR_H)
        .fill({ color: neutral, alpha: 0.001 });
      x += cell.width + CELL_GAP;
    }
    this.stopsX = x;
    this.stopsHit
      .clear()
      .rect(x - CELL_GAP / 2, 0, STOPS_BUTTON_W + CELL_GAP, BAR_H)
      .fill({ color: neutral, alpha: 0.001 });
  }

  private draw(): void {
    if (!this.state) return;
    const { gameTheme: t, appTheme: app } = this.theme;
    const seatHex = this.activeHex();
    const seat = hexToNum(seatHex);
    const seatInk = readableTextColor(seatHex, t.canvas.shadow, t.textOnTinted);
    const surfaceHex = t.phaseStrip.background;
    const surface = hexToNum(surfaceHex);
    const surfaceInk = readableTextColor(surfaceHex, t.canvas.shadow, t.textOnTinted);
    const light = hexToNum(t.textOnTinted);
    const setInk = readableTextColor(t.textOnTinted, t.canvas.shadow, t.textOnTinted);
    const fullHeight = BAR_H + RADIUS * 2;
    this.panel
      .clear()
      .rect(0, 0, this.width, fullHeight)
      .fill({ color: this.surface ?? hexToNum(app.card) });
    this.lickFill.clear().rect(0, 0, this.width, fullHeight).fill({ color: seat });
    const { entry: currentEntry } = this.cells[this.currentIndex]!;
    const currentStep = this.state.currentStep;
    const currentShort =
      PHASES.find((phase) => phase.id === currentStep && currentEntry.steps.includes(phase.id))
        ?.short ?? currentEntry.short;
    this.lickLabel.text = currentShort;
    this.lickLabel.style.fill = seatInk;
    const stops = this.stops();
    this.cells.forEach((cell, index) => {
      const { entry, x, width, shape, label } = cell;
      const current = index === this.currentIndex;
      const enabled = entry.steps.some((step) => stops?.has(step));
      const hovered = this.hoveredCell === index;
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
      label.text = current ? currentShort : entry.short;
      label.style.fill = current ? seatInk : enabled ? setInk : surfaceInk;
    });
    const centerX = this.stopsX + STOPS_BUTTON_W / 2;
    const centerY = PAD + CELL_H / 2;
    const half = STOPS_ICON_HALF;
    const arm = STOPS_ICON_ARM;
    this.stopsButton
      .clear()
      .roundRect(this.stopsX, PAD, STOPS_BUTTON_W, CELL_H, 3)
      .fill({ color: this.stopsHovered ? mixNum(surface, light, 0.25) : surface });
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const cornerX = centerX + dx * half;
      const cornerY = centerY + dy * half;
      this.stopsButton
        .moveTo(cornerX - dx * arm, cornerY)
        .lineTo(cornerX, cornerY)
        .lineTo(cornerX, cornerY - dy * arm);
    }
    this.stopsButton.stroke({ color: hexToNum(surfaceInk), width: 1.5, cap: "round" });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

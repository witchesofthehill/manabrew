import { Graphics } from "pixi.js";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "./colorUtils";
import type { ScreenPos } from "./types";

const MIN_MARQUEE_SIZE = 4;
const MARQUEE_CORNER_RADIUS = 3;
const MARQUEE_STROKE_WIDTH = 2;
const MARQUEE_STROKE_ALPHA = 0.8;
const MARQUEE_Z_INDEX = 9000;
const DEFAULT_MARQUEE_FILL_ALPHA = 0.1;

export class MarqueeHandler {
  private gfx: Graphics;
  private active = false;
  private destroyed = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  private shiftHeld = false;
  private color: number;
  private fillAlpha: number;

  constructor(color?: number, fillAlpha = DEFAULT_MARQUEE_FILL_ALPHA) {
    this.gfx = new Graphics();
    this.gfx.visible = false;
    this.gfx.zIndex = MARQUEE_Z_INDEX;
    this.color = color ?? hexToNum(getTheme().gameTheme.cardSelection);
    this.fillAlpha = fillAlpha;
  }

  get graphics(): Graphics {
    return this.gfx;
  }

  get isActive(): boolean {
    return this.active;
  }

  setColor(color: number): void {
    this.color = color;
  }

  start(x: number, y: number, shift: boolean): void {
    if (this.destroyed) return;
    this.active = true;
    this.startX = x;
    this.startY = y;
    this.currentX = x;
    this.currentY = y;
    this.shiftHeld = shift;
    this.gfx.visible = true;
    this.redraw();
  }

  move(x: number, y: number): void {
    if (this.destroyed || !this.active) return;
    this.currentX = x;
    this.currentY = y;
    this.redraw();
  }

  end(cardPositions: Map<string, ScreenPos>, existingSelection: Set<string>): Set<string> {
    this.active = false;
    this.gfx.visible = false;
    this.gfx.clear();

    const rect = this.getRect();
    if (rect.width < MIN_MARQUEE_SIZE && rect.height < MIN_MARQUEE_SIZE) {
      return this.shiftHeld ? existingSelection : new Set();
    }

    const selected = new Set<string>();
    if (this.shiftHeld) {
      for (const id of existingSelection) selected.add(id);
    }

    for (const [id, pos] of cardPositions) {
      const left = pos.x - CARD_W / 2;
      const top = pos.y - CARD_H / 2;
      if (
        rect.x < left + CARD_W &&
        rect.x + rect.width > left &&
        rect.y < top + CARD_H &&
        rect.y + rect.height > top
      ) {
        selected.add(id);
      }
    }

    return selected;
  }

  cancel(): void {
    this.active = false;
    this.gfx.visible = false;
    this.gfx.clear();
  }

  private getRect(): { x: number; y: number; width: number; height: number } {
    return {
      x: Math.min(this.startX, this.currentX),
      y: Math.min(this.startY, this.currentY),
      width: Math.abs(this.currentX - this.startX),
      height: Math.abs(this.currentY - this.startY),
    };
  }

  private redraw(): void {
    if (this.destroyed) return;
    const r = this.getRect();
    this.gfx.clear();
    this.gfx.roundRect(r.x, r.y, r.width, r.height, MARQUEE_CORNER_RADIUS);
    this.gfx.fill({ color: this.color, alpha: this.fillAlpha });
    this.gfx.stroke({
      color: this.color,
      width: MARQUEE_STROKE_WIDTH,
      alpha: MARQUEE_STROKE_ALPHA,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = false;
    this.gfx.destroy({ children: true });
  }
}

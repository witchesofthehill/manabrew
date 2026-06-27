import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "../colorUtils";
import type { PlayerHudTooltipContent } from "./playerHud.types";

const FONT = "Inter, system-ui, -apple-system, sans-serif";
const PAD = 8;
const MAX_W = 240;

/** A small themed hover tooltip shared by all capsules in a `PlayerHudLayer`.
 *  Shows a badge/player label and, for The Ring, the active/inactive ability
 *  list. Positioned above the hovered item (or below for top-anchored seats). */
export class PlayerHudTooltip {
  readonly container: Container;
  private theme: Theme;
  private bg = new Graphics();
  private title: Text;
  private lines: Text[] = [];
  private vw = 0;
  private vh = 0;

  constructor(theme: Theme) {
    this.theme = theme;
    this.container = new Container();
    this.container.eventMode = "none";
    this.container.visible = false;
    this.title = new Text({ text: "", style: this.titleStyle() });
    this.container.addChild(this.bg, this.title);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  setViewport(width: number, height: number): void {
    this.vw = width;
    this.vh = height;
  }

  hide(): void {
    this.container.visible = false;
  }

  show(
    content: PlayerHudTooltipContent,
    cx: number,
    top: number,
    bottom: number,
    below: boolean,
  ): void {
    const gt = this.theme.gameTheme;
    this.title.style = this.titleStyle();
    this.title.text = content.title;
    let contentW = this.title.width;
    let y = PAD;
    this.title.position.set(PAD, y);
    y += this.title.height;

    const lines = content.lines ?? [];
    this.ensureLines(lines.length);
    if (lines.length) y += 4;
    for (let i = 0; i < lines.length; i++) {
      const t = this.lines[i]!;
      t.visible = true;
      t.style = this.lineStyle(lines[i]!.active);
      t.text = `• ${lines[i]!.text}`;
      t.position.set(PAD, y);
      contentW = Math.max(contentW, t.width);
      y += t.height + 2;
    }
    for (let i = lines.length; i < this.lines.length; i++) this.lines[i]!.visible = false;

    const w = contentW + PAD * 2;
    const h = y + PAD;
    this.bg.clear();
    this.bg.roundRect(0, 0, w, h, 6);
    this.bg.fill({ color: hexToNum(gt.canvas.background), alpha: 0.96 });
    this.bg.roundRect(0.5, 0.5, w - 1, h - 1, 6);
    this.bg.stroke({ color: hexToNum(gt.textGhost), width: 1, alpha: 0.3 });

    const gap = 6;
    let x = cx - w / 2;
    if (this.vw > 0) x = Math.max(4, Math.min(x, this.vw - w - 4));
    let yPos = below ? bottom + gap : top - gap - h;
    // Flip if the preferred side would clip off the top/bottom edge.
    if (!below && yPos < 4) yPos = bottom + gap;
    else if (below && this.vh > 0 && yPos + h > this.vh - 4) yPos = top - gap - h;
    this.container.position.set(Math.round(x), Math.round(yPos));
    this.container.visible = true;
  }

  private ensureLines(n: number): void {
    while (this.lines.length < n) {
      const t = new Text({ text: "", style: this.lineStyle(true) });
      this.container.addChild(t);
      this.lines.push(t);
    }
  }

  private titleStyle(): TextStyle {
    return new TextStyle({
      fontFamily: FONT,
      fontSize: 12,
      fontWeight: "700",
      fill: hexToNum(this.theme.gameTheme.textOnTinted),
      wordWrap: true,
      wordWrapWidth: MAX_W - PAD * 2,
    });
  }

  private lineStyle(active: boolean): TextStyle {
    const gt = this.theme.gameTheme;
    return new TextStyle({
      fontFamily: FONT,
      fontSize: 11,
      fontWeight: active ? "600" : "400",
      fill: hexToNum(active ? gt.textOnTinted : gt.textMuted),
      wordWrap: true,
      wordWrapWidth: MAX_W - PAD * 2,
    });
  }
}

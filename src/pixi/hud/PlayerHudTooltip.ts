import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "../colorUtils";
import type { PlayerHudTooltipContent } from "./playerHud.types";

const BODY_FONT = "Inter, system-ui, -apple-system, sans-serif";
const TITLE_FONT = "Cormorant Garamond, Georgia, serif";
const PAD_X = 11;
const PAD_Y = 9;
const MAX_W = 250;
const TITLE_BODY_GAP = 10;
const LINE_GAP = 3;
const RADIUS = 5;
const SHADOW_OFFSET_Y = 3;

export class PlayerHudTooltip {
  readonly container: Container;
  private theme: Theme;
  private bg = new Graphics();
  private title: Text;
  private activeLineStyle: TextStyle;
  private inactiveLineStyle: TextStyle;
  private lines: Text[] = [];
  private vw = 0;
  private vh = 0;

  constructor(theme: Theme) {
    this.theme = theme;
    this.container = new Container();
    this.container.eventMode = "none";
    this.container.visible = false;
    this.activeLineStyle = this.lineStyle(true);
    this.inactiveLineStyle = this.lineStyle(false);
    this.title = new Text({ text: "", style: this.titleStyle() });
    this.container.addChild(this.bg, this.title);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.title.style = this.titleStyle();
    this.activeLineStyle = this.lineStyle(true);
    this.inactiveLineStyle = this.lineStyle(false);
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
    accentColor: string,
  ): void {
    const gt = this.theme.gameTheme;
    const app = this.theme.appTheme;
    const accent = hexToNum(accentColor);
    this.title.text = content.title;
    let contentW = this.title.width;
    let y = PAD_Y;
    this.title.position.set(PAD_X, y);
    y += this.title.height;

    const lines = content.lines ?? [];
    this.ensureLines(lines.length);
    const dividerY = lines.length ? y + TITLE_BODY_GAP / 2 : null;
    if (lines.length) y += TITLE_BODY_GAP;
    for (let i = 0; i < lines.length; i++) {
      const t = this.lines[i]!;
      t.visible = true;
      t.style = lines[i]!.active ? this.activeLineStyle : this.inactiveLineStyle;
      t.text = `•  ${lines[i]!.text}`;
      t.position.set(PAD_X, y);
      contentW = Math.max(contentW, t.width);
      y += t.height + LINE_GAP;
    }
    for (let i = lines.length; i < this.lines.length; i++) this.lines[i]!.visible = false;

    const w = contentW + PAD_X * 2;
    const h = y - (lines.length ? LINE_GAP : 0) + PAD_Y;
    const visualH = h + SHADOW_OFFSET_Y;
    this.bg.clear();
    this.bg.roundRect(0, SHADOW_OFFSET_Y, w, h, RADIUS);
    this.bg.fill({ color: hexToNum(gt.canvas.shadow), alpha: 0.52 });
    this.bg.roundRect(0, 0, w, h, RADIUS);
    this.bg.fill({ color: hexToNum(app.popover), alpha: 0.98 });
    this.bg.roundRect(0, 0, w, h, RADIUS);
    this.bg.fill({ color: accent, alpha: 0.07 });
    this.bg.roundRect(0.5, 0.5, w - 1, h - 1, RADIUS - 0.5);
    this.bg.stroke({ color: accent, width: 1, alpha: 0.55 });
    this.bg.moveTo(RADIUS + 4, 1);
    this.bg.lineTo(w - RADIUS - 4, 1);
    this.bg.stroke({ color: accent, width: 1.5, alpha: 0.95 });
    if (dividerY !== null) {
      this.bg.moveTo(PAD_X, dividerY);
      this.bg.lineTo(w - PAD_X, dividerY);
      this.bg.stroke({ color: accent, width: 1, alpha: 0.35 });
    }

    const gap = 7;
    let x = cx - w / 2;
    if (this.vw > 0) x = Math.max(4, Math.min(x, this.vw - w - 4));
    let yPos = below ? bottom + gap : top - gap - visualH;
    if (!below && yPos < 4) yPos = bottom + gap;
    else if (below && this.vh > 0 && yPos + visualH > this.vh - 4) yPos = top - gap - visualH;
    this.container.position.set(Math.round(x), Math.round(yPos));
    this.container.visible = true;
  }

  private ensureLines(n: number): void {
    while (this.lines.length < n) {
      const t = new Text({ text: "", style: this.activeLineStyle });
      this.container.addChild(t);
      this.lines.push(t);
    }
  }

  private titleStyle(): TextStyle {
    return new TextStyle({
      fontFamily: TITLE_FONT,
      fontSize: 15,
      fontWeight: "700",
      letterSpacing: 0.35,
      fill: hexToNum(this.theme.appTheme["popover-foreground"]),
      wordWrap: true,
      wordWrapWidth: MAX_W - PAD_X * 2,
    });
  }

  private lineStyle(active: boolean): TextStyle {
    const app = this.theme.appTheme;
    return new TextStyle({
      fontFamily: BODY_FONT,
      fontSize: 11,
      fontWeight: active ? "600" : "400",
      lineHeight: 15,
      fill: hexToNum(active ? app["popover-foreground"] : app["muted-foreground"]),
      wordWrap: true,
      wordWrapWidth: MAX_W - PAD_X * 2,
    });
  }
}

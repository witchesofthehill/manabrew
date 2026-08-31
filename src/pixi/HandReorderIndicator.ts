import { Container, Graphics } from "pixi.js";
import { CARD_RADIUS } from "./constants";
import { CARD_W } from "@/components/game/game.constants";
import { hexToNum } from "./colorUtils";
import type { Theme } from "@/hooks/useTheme";
import { lerp } from "./board/pixiHelpers";

const ALPHA_LERP = 0.34;
const SCALE_LERP = 0.28;
const VISIBLE_ALPHA = 0.72;
const START_SCALE = 0.92;

export class HandReorderIndicator {
  readonly view = new Container();
  private outline = new Graphics();
  private targetAlpha = 0;
  private targetScale = 1;

  constructor() {
    this.view.eventMode = "none";
    this.view.alpha = 0;
    this.view.addChild(this.outline);
  }

  show(x: number, y: number, width: number, height: number, rotation: number, theme: Theme): void {
    this.outline.clear();
    this.outline.roundRect(-width / 2, -height / 2, width, height, (CARD_RADIUS * width) / CARD_W);
    this.outline.fill({ color: hexToNum(theme.gameTheme.cardRing), alpha: 0.08 });
    this.outline.stroke({ color: hexToNum(theme.gameTheme.cardRing), width: 2, alpha: 0.9 });
    this.view.position.set(x, y);
    this.view.rotation = rotation;
    if (this.targetAlpha === 0) this.view.scale.set(START_SCALE);
    this.targetAlpha = VISIBLE_ALPHA;
    this.targetScale = 1;
  }

  hide(): void {
    this.targetAlpha = 0;
    this.targetScale = START_SCALE;
  }

  animate(): void {
    this.view.alpha = lerp(this.view.alpha, this.targetAlpha, ALPHA_LERP, 0.01);
    const scale = lerp(this.view.scale.x, this.targetScale, SCALE_LERP, 0.002);
    this.view.scale.set(scale);
    this.view.visible = this.view.alpha > 0;
  }
}

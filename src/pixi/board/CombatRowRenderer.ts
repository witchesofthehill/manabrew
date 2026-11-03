import { getUiFontFloor, UI_FONT_FAMILY } from "@/themes/typography";
import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "../colorUtils";
import { gameIconTexture } from "../gameIconCache";
import {
  COMBAT_ARROW_ALPHA,
  COMBAT_ARROW_EDGE_FADE,
  COMBAT_ARROW_SPACING_FRAC,
  COMBAT_ARROW_PERIOD_MS,
  COMBAT_ARROW_ROWS,
  COMBAT_ARROW_WIDTH_FRAC,
  Z_COMBAT_STAGED,
} from "../constants";
import { pulse } from "../effects/animation";

const COMBAT_ARROW_ICON = "plain-arrow";

interface CombatRowConnector {
  ax: number;
  bx: number;
  by: number;
}

export interface CombatRowRenderSpec {
  y: number;
  stripLeft: number;
  stripTop: number;
  stripWidth: number;
  stripHeight: number;
  cardWidth: number;
  arrowLeft: number;
  arrowWidth: number;
  direction: 1 | -1;
  connectors: CombatRowConnector[];
}

interface RenderSnapshot {
  y: number;
  stripLeft: number;
  stripTop: number;
  stripWidth: number;
  stripHeight: number;
  cardWidth: number;
  arrowLeft: number;
  arrowWidth: number;
  direction: 1 | -1;
  attackColor: string;
  defenseColor: string;
  textColor: string;
  fontSize: number;
  connectors: readonly number[];
}

export class CombatRowRenderer {
  private graphics = new Graphics();
  private pressure = new Graphics();
  private assignmentLabels = new Container();
  private arrows = new Container();
  private arrowTexture: Texture | null = null;
  private arrowBand: { top: number; height: number; direction: 1 | -1; size: number } | null = null;
  private snapshot: RenderSnapshot | null = null;
  private container: Container;

  constructor(container: Container) {
    this.container = container;
    this.arrows.eventMode = "none";
    this.arrows.zIndex = Z_COMBAT_STAGED - 6;
    this.container.addChild(this.arrows);
    this.graphics.eventMode = "none";
    this.graphics.zIndex = Z_COMBAT_STAGED - 5;
    this.container.addChild(this.graphics);
    this.pressure.eventMode = "none";
    this.pressure.zIndex = Z_COMBAT_STAGED - 4;
    this.pressure.blendMode = "screen";
    this.pressure.visible = false;
    this.assignmentLabels.eventMode = "none";
    this.assignmentLabels.zIndex = Z_COMBAT_STAGED + 10;
    this.container.addChild(this.assignmentLabels);
    this.container.addChild(this.pressure);
  }

  hide(): void {
    if (this.snapshot === null) return;
    this.snapshot = null;
    this.graphics.clear();
    this.pressure.clear();
    this.clearAssignmentLabels();
    this.clearArrows();
    this.pressure.visible = false;
  }

  render(spec: CombatRowRenderSpec, theme: Theme): void {
    if (this.matchesSnapshot(spec, theme)) return;
    const colors = theme.gameTheme;
    this.captureSnapshot(spec, theme);
    this.graphics.clear();
    this.clearAssignmentLabels();
    this.pressure.clear();
    this.pressure.visible = true;

    const attackColor = hexToNum(colors.promptAction.attackAction);
    this.buildArrows(spec, attackColor);

    if (spec.connectors.length > 0) {
      for (const connector of spec.connectors) {
        this.graphics.moveTo(connector.ax, spec.y);
        this.graphics.lineTo(connector.bx, connector.by);
      }
      this.graphics.stroke({
        color: hexToNum(colors.promptAction.defenseAction),
        width: 2,
        alpha: 0.55,
      });
      for (const connector of spec.connectors) {
        this.pressure.moveTo(connector.ax, spec.y);
        this.pressure.lineTo(connector.bx, connector.by);
      }
      this.pressure.stroke({ color: attackColor, width: 5, alpha: 0.28 });
    }

    const assignments = new Map<number, number>();
    for (const connector of spec.connectors) {
      assignments.set(connector.ax, (assignments.get(connector.ax) ?? 0) + 1);
    }
    for (const [x, count] of assignments) {
      if (count < 2) continue;
      const badge = new Container();
      const text = new Text({
        text: String(count),
        style: {
          fontFamily: UI_FONT_FAMILY,
          fontSize: Math.max(11, getUiFontFloor("meta")),
          fontWeight: "800",
          fill: hexToNum(colors.textOnTinted),
        },
      });
      text.resolution = 2;
      text.anchor.set(0.5);
      const radius = Math.ceil(Math.max(text.width, text.height) / 2) + 4;
      const background = new Graphics()
        .circle(0, 0, radius)
        .fill({ color: hexToNum(colors.promptAction.defenseAction), alpha: 0.95 })
        .circle(0, 0, radius)
        .stroke({ color: hexToNum(colors.textOnTinted), width: 1, alpha: 0.75 });
      badge.position.set(
        x + Math.max(0, spec.cardWidth / 2 - radius - 2),
        spec.stripTop + spec.stripHeight / 2,
      );
      badge.addChild(background, text);
      this.assignmentLabels.addChild(badge);
    }
  }

  tick(now: number, motionEnabled: boolean): void {
    if (!this.pressure.visible) return;
    this.pressure.alpha = motionEnabled ? pulse(now, 1250, 0.28, 0.9) : 0.58;
    this.tickArrows(now, motionEnabled);
  }

  private buildArrows(spec: CombatRowRenderSpec, color: number): void {
    this.clearArrows();
    const spacing = spec.cardWidth * COMBAT_ARROW_SPACING_FRAC;
    const columns = Math.floor(spec.arrowWidth / spacing);
    if (columns < 1) return;
    this.arrowBand = {
      top: spec.stripTop,
      height: spec.stripHeight,
      direction: spec.direction,
      size: spec.cardWidth * COMBAT_ARROW_WIDTH_FRAC,
    };
    const firstX = spec.arrowLeft + (spec.arrowWidth - (columns - 1) * spacing) / 2;
    const fade = spacing * 1.5;
    for (let index = 0; index < COMBAT_ARROW_ROWS; index++) {
      const row = new Container();
      row.alpha = 0;
      for (let column = 0; column < columns; column++) {
        const arrow = new Sprite();
        arrow.anchor.set(0.5);
        arrow.tint = color;
        arrow.x = firstX + column * spacing;
        const edge = Math.min(arrow.x - spec.arrowLeft, spec.arrowLeft + spec.arrowWidth - arrow.x);
        arrow.alpha = edgeFade(edge / fade);
        row.addChild(arrow);
      }
      this.arrows.addChild(row);
    }
    if (this.arrowTexture) this.applyArrowTexture(this.arrowTexture);
    else
      void gameIconTexture(COMBAT_ARROW_ICON).then((texture) => {
        this.arrowTexture = texture;
        this.applyArrowTexture(texture);
      });
  }

  private applyArrowTexture(texture: Texture): void {
    const band = this.arrowBand;
    if (!band) return;
    for (const row of this.arrows.children) {
      for (const arrow of row.children as Sprite[]) {
        arrow.texture = texture;
        arrow.scale.set(band.size / texture.width, (band.direction * band.size) / texture.height);
      }
    }
  }

  private tickArrows(now: number, motionEnabled: boolean): void {
    const band = this.arrowBand;
    if (!band) return;
    const cycle = motionEnabled ? (now % COMBAT_ARROW_PERIOD_MS) / COMBAT_ARROW_PERIOD_MS : 0.25;
    this.arrows.children.forEach((row, index) => {
      const progress = (cycle + index / COMBAT_ARROW_ROWS) % 1;
      const travelled = band.direction === 1 ? progress : 1 - progress;
      row.y = band.top + travelled * band.height;
      row.alpha =
        COMBAT_ARROW_ALPHA * edgeFade(Math.min(progress, 1 - progress) / COMBAT_ARROW_EDGE_FADE);
    });
  }

  private clearArrows(): void {
    this.arrows.removeChildren().forEach((row) => row.destroy({ children: true }));
    this.arrowBand = null;
  }

  private clearAssignmentLabels(): void {
    this.assignmentLabels.removeChildren().forEach((child) => child.destroy({ children: true }));
  }

  private matchesSnapshot(spec: CombatRowRenderSpec, theme: Theme): boolean {
    const snapshot = this.snapshot;
    if (!snapshot) return false;
    const colors = theme.gameTheme;
    if (
      spec.y !== snapshot.y ||
      spec.stripLeft !== snapshot.stripLeft ||
      spec.stripTop !== snapshot.stripTop ||
      spec.stripWidth !== snapshot.stripWidth ||
      spec.cardWidth !== snapshot.cardWidth ||
      spec.arrowLeft !== snapshot.arrowLeft ||
      spec.arrowWidth !== snapshot.arrowWidth ||
      spec.direction !== snapshot.direction ||
      spec.stripHeight !== snapshot.stripHeight ||
      Math.max(11, getUiFontFloor("meta")) !== snapshot.fontSize ||
      colors.promptAction.attackAction !== snapshot.attackColor ||
      colors.textOnTinted !== snapshot.textColor ||
      colors.promptAction.defenseAction !== snapshot.defenseColor
    ) {
      return false;
    }
    if (spec.connectors.length * 3 !== snapshot.connectors.length) return false;
    for (let index = 0; index < spec.connectors.length; index++) {
      const connector = spec.connectors[index]!;
      const offset = index * 3;
      if (
        connector.ax !== snapshot.connectors[offset] ||
        connector.bx !== snapshot.connectors[offset + 1] ||
        connector.by !== snapshot.connectors[offset + 2]
      ) {
        return false;
      }
    }
    return true;
  }

  private captureSnapshot(spec: CombatRowRenderSpec, theme: Theme): void {
    const connectors = spec.connectors.flatMap((connector) => [
      connector.ax,
      connector.bx,
      connector.by,
    ]);
    const colors = theme.gameTheme;
    this.snapshot = {
      y: spec.y,
      stripLeft: spec.stripLeft,
      stripTop: spec.stripTop,
      stripWidth: spec.stripWidth,
      cardWidth: spec.cardWidth,
      arrowLeft: spec.arrowLeft,
      arrowWidth: spec.arrowWidth,
      direction: spec.direction,
      stripHeight: spec.stripHeight,
      attackColor: colors.promptAction.attackAction,
      defenseColor: colors.promptAction.defenseAction,
      textColor: colors.textOnTinted,
      fontSize: Math.max(11, getUiFontFloor("meta")),
      connectors,
    };
  }
}

function edgeFade(distance: number): number {
  const t = Math.max(0, Math.min(1, distance));
  return t * t * (3 - 2 * t);
}

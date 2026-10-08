import { Container, Graphics, Text } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "../colorUtils";
import { Z_COMBAT_STAGED } from "../constants";
import { pulse } from "../effects/animation";

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
  direction: -1 | 1;
  attackerXs: number[];
  connectors: CombatRowConnector[];
}

interface RenderSnapshot {
  y: number;
  stripLeft: number;
  stripTop: number;
  stripWidth: number;
  stripHeight: number;
  cardWidth: number;
  direction: -1 | 1;
  attackColor: string;
  defenseColor: string;
  textColor: string;
  connectors: readonly number[];
  attackerXs: readonly number[];
}

export class CombatRowRenderer {
  private graphics = new Graphics();
  private pressure = new Graphics();
  private assignmentLabels = new Container();
  private snapshot: RenderSnapshot | null = null;
  private container: Container;

  constructor(container: Container) {
    this.container = container;
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
    this.graphics.roundRect(spec.stripLeft, spec.stripTop, spec.stripWidth, spec.stripHeight, 10);
    this.graphics.fill({ color: attackColor, alpha: 0.22 });
    this.graphics.roundRect(spec.stripLeft, spec.stripTop, spec.stripWidth, spec.stripHeight, 10);
    this.graphics.stroke({ color: attackColor, width: 1.5, alpha: 0.6 });

    const edgeY = spec.direction > 0 ? spec.stripTop + spec.stripHeight - 1 : spec.stripTop + 1;
    for (const x of spec.attackerXs) {
      this.graphics.moveTo(x - 8, edgeY - spec.direction * 5);
      this.graphics.lineTo(x, edgeY);
      this.graphics.lineTo(x + 8, edgeY - spec.direction * 5);
    }
    this.graphics.stroke({ color: attackColor, width: 2, alpha: 0.9 });

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
      const background = new Graphics()
        .circle(0, 0, 10)
        .fill({ color: hexToNum(colors.promptAction.defenseAction), alpha: 0.95 })
        .circle(0, 0, 10)
        .stroke({ color: hexToNum(colors.textOnTinted), width: 1, alpha: 0.75 });
      const text = new Text({
        text: String(count),
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 11,
          fontWeight: "800",
          fill: hexToNum(colors.textOnTinted),
        },
      });
      text.resolution = 2;
      text.anchor.set(0.5);
      badge.position.set(
        x + spec.cardWidth / 2 - 8,
        spec.stripTop + Math.min(12, spec.stripHeight / 2),
      );
      badge.addChild(background, text);
      this.assignmentLabels.addChild(badge);
    }

    this.pressure
      .roundRect(
        spec.stripLeft + 1,
        spec.stripTop + 1,
        spec.stripWidth - 2,
        spec.stripHeight - 2,
        9,
      )
      .stroke({ color: attackColor, width: 4, alpha: 0.34 });
  }

  tick(now: number, motionEnabled: boolean): void {
    if (!this.pressure.visible) return;
    this.pressure.alpha = motionEnabled ? pulse(now, 1250, 0.28, 0.9) : 0.58;
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
      spec.direction !== snapshot.direction ||
      spec.stripHeight !== snapshot.stripHeight ||
      colors.promptAction.attackAction !== snapshot.attackColor ||
      colors.textOnTinted !== snapshot.textColor ||
      colors.promptAction.defenseAction !== snapshot.defenseColor
    ) {
      return false;
    }
    if (spec.attackerXs.length !== snapshot.attackerXs.length) return false;
    for (let index = 0; index < spec.attackerXs.length; index++) {
      if (spec.attackerXs[index] !== snapshot.attackerXs[index]) return false;
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
      direction: spec.direction,
      stripHeight: spec.stripHeight,
      attackColor: colors.promptAction.attackAction,
      defenseColor: colors.promptAction.defenseAction,
      textColor: colors.textOnTinted,
      attackerXs: [...spec.attackerXs],
      connectors,
    };
  }
}

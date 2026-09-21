import { Container, Graphics } from "pixi.js";
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
  connectors: CombatRowConnector[];
}

interface RenderSnapshot {
  y: number;
  stripLeft: number;
  stripTop: number;
  stripWidth: number;
  stripHeight: number;
  attackColor: string;
  defenseColor: string;
  connectors: readonly number[];
}

export class CombatRowRenderer {
  private graphics = new Graphics();
  private pressure = new Graphics();
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
    this.container.addChild(this.pressure);
  }

  hide(): void {
    if (this.snapshot === null) return;
    this.snapshot = null;
    this.graphics.clear();
    this.pressure.clear();
    this.pressure.visible = false;
  }

  render(spec: CombatRowRenderSpec, theme: Theme): void {
    if (this.matchesSnapshot(spec, theme)) return;
    const colors = theme.gameTheme;
    this.captureSnapshot(spec, theme);
    this.graphics.clear();
    this.pressure.clear();
    this.pressure.visible = true;

    const attackColor = hexToNum(colors.promptAction.attackAction);
    this.graphics.roundRect(spec.stripLeft, spec.stripTop, spec.stripWidth, spec.stripHeight, 10);
    this.graphics.fill({ color: attackColor, alpha: 0.22 });
    this.graphics.roundRect(spec.stripLeft, spec.stripTop, spec.stripWidth, spec.stripHeight, 10);
    this.graphics.stroke({ color: attackColor, width: 1.5, alpha: 0.6 });

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

  private matchesSnapshot(spec: CombatRowRenderSpec, theme: Theme): boolean {
    const snapshot = this.snapshot;
    if (!snapshot) return false;
    const colors = theme.gameTheme;
    if (
      spec.y !== snapshot.y ||
      spec.stripLeft !== snapshot.stripLeft ||
      spec.stripTop !== snapshot.stripTop ||
      spec.stripWidth !== snapshot.stripWidth ||
      spec.stripHeight !== snapshot.stripHeight ||
      colors.promptAction.attackAction !== snapshot.attackColor ||
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
      stripHeight: spec.stripHeight,
      attackColor: colors.promptAction.attackAction,
      defenseColor: colors.promptAction.defenseAction,
      connectors,
    };
  }
}

import { Container } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { PlayerHudCapsule } from "./PlayerHudCapsule";
import type { PlayerHudSpec } from "./playerHud.types";

export const PLAYER_HUD_HEIGHT_PX = 34;
export const SELF_PLAYER_HUD_HEIGHT_PX = 44;
export const PLAYER_HUD_TOP_MARGIN_PX = 8;
export const PLAYER_HUD_SIDE_MARGIN_PX = 10;
export const PLAYER_HUD_MAX_WIDTH_PX = 280;
export const PLAYER_HUD_COLUMN_HEIGHT_PX = 124;

/** Owns one `PlayerHudCapsule` per player and the root container they live in.
 *  `BoardScene` positions each capsule via `setRect`. */
export class PlayerHudLayer {
  readonly container: Container;
  private theme: Theme;
  private onTarget: (playerId: string) => void;
  private capsules = new Map<string, PlayerHudCapsule>();

  constructor(theme: Theme, onTarget: (playerId: string) => void) {
    this.theme = theme;
    this.onTarget = onTarget;
    this.container = new Container();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    for (const capsule of this.capsules.values()) capsule.setTheme(theme);
  }

  setBars(specs: PlayerHudSpec[]): void {
    const seen = new Set<string>();
    for (const spec of specs) {
      seen.add(spec.playerId);
      let capsule = this.capsules.get(spec.playerId);
      if (!capsule) {
        capsule = new PlayerHudCapsule(this.theme, spec, () => this.onTarget(spec.playerId));
        this.container.addChild(capsule.container);
        this.capsules.set(spec.playerId, capsule);
      }
      capsule.setSpec(spec);
    }
    for (const [id, capsule] of [...this.capsules]) {
      if (seen.has(id)) continue;
      capsule.destroy();
      this.capsules.delete(id);
    }
  }

  setRect(
    playerId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    column: boolean,
  ): void {
    this.capsules.get(playerId)?.setRect(x, y, width, height, column);
  }

  destroy(): void {
    for (const capsule of this.capsules.values()) capsule.destroy();
    this.capsules.clear();
    this.container.destroy({ children: true });
  }
}

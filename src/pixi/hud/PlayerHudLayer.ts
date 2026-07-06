import { Container } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { PlayerHudCapsule } from "./PlayerHudCapsule";
import { PlayerHudTooltip } from "./PlayerHudTooltip";
import type { PlayerHudSpec } from "./playerHud.types";
import type { ScreenBounds, ScreenPos } from "@/pixi/types";

export const PLAYER_HUD_HEIGHT_PX = 60;
export const SELF_PLAYER_HUD_HEIGHT_PX = 60;
export const SELF_PLAYER_HUD_COMPACT_SCALE = 0.7;
export const PLAYER_HUD_TOP_MARGIN_PX = 8;
export const PLAYER_HUD_SIDE_MARGIN_PX = 10;
export const PLAYER_HUD_MAX_WIDTH_PX = 280;

// Above this y a capsule is a top-anchored opponent, so its tooltip drops below
// the badge instead of rising above it (off the top edge).
const ANCHOR_BELOW_Y = 200;

/** Owns one `PlayerHudCapsule` per player, a shared hover tooltip, and the root
 *  container they live in. `BoardScene` positions each capsule via `setRect`. */
export class PlayerHudLayer {
  readonly container: Container;
  private theme: Theme;
  private onTarget: (playerId: string) => void;
  private onShowSheet: (playerId: string) => void;
  private onMenu: () => void;
  private capsules = new Map<string, PlayerHudCapsule>();
  private tooltip: PlayerHudTooltip;
  private compact = false;

  constructor(
    theme: Theme,
    onTarget: (playerId: string) => void,
    onShowSheet: (playerId: string) => void,
    onMenu: () => void,
  ) {
    this.theme = theme;
    this.onTarget = onTarget;
    this.onShowSheet = onShowSheet;
    this.onMenu = onMenu;
    this.container = new Container();
    this.container.sortableChildren = true;
    this.tooltip = new PlayerHudTooltip(theme);
    this.tooltip.container.zIndex = 1000;
    this.container.addChild(this.tooltip.container);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.tooltip.setTheme(theme);
    for (const capsule of this.capsules.values()) capsule.setTheme(theme);
  }

  setViewport(width: number, height: number): void {
    this.tooltip.setViewport(width, height);
  }

  setBars(specs: PlayerHudSpec[]): void {
    const seen = new Set<string>();
    for (const spec of specs) {
      seen.add(spec.playerId);
      let capsule = this.capsules.get(spec.playerId);
      if (!capsule) {
        capsule = new PlayerHudCapsule(
          this.theme,
          spec,
          () => this.onTarget(spec.playerId),
          () => this.onShowSheet(spec.playerId),
          () => this.onMenu(),
          (content, cx, top, bottom) => {
            if (!content) this.tooltip.hide();
            else this.tooltip.show(content, cx!, top!, bottom!, top! < ANCHOR_BELOW_Y);
          },
        );
        this.container.addChild(capsule.container);
        this.capsules.set(spec.playerId, capsule);
        capsule.setCompact(this.compact);
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

  setCapsuleScale(playerId: string, scale: number): void {
    this.capsules.get(playerId)?.setScale(scale);
  }

  setCompact(compact: boolean): void {
    if (this.compact === compact) return;
    this.compact = compact;
    for (const capsule of this.capsules.values()) capsule.setCompact(compact);
  }

  getPlayerAnchor(playerId: string): ScreenPos | null {
    return this.capsules.get(playerId)?.getAvatarCenter() ?? null;
  }

  getZoneAnchor(playerId: string, zoneKey: string): ScreenPos | null {
    return this.capsules.get(playerId)?.getZoneAnchor(zoneKey) ?? null;
  }

  getCapsuleBounds(playerId: string): ScreenBounds | null {
    return this.capsules.get(playerId)?.getKeepOutBounds() ?? null;
  }

  destroy(): void {
    for (const capsule of this.capsules.values()) capsule.destroy();
    this.capsules.clear();
    this.container.destroy({ children: true });
  }
}

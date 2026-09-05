import { Container } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { PlayerHudCapsule } from "./PlayerHudCapsule";
import { PlayerHudTooltip } from "./PlayerHudTooltip";
import type { PlayerHudSpec } from "./playerHud.types";
import type { ScreenBounds, ScreenPos } from "@/pixi/types";

export const SELF_PLAYER_HUD_HEIGHT_PX = 164;
export const SELF_PLAYER_HUD_MAX_WIDTH_PX = 400;
export const SELF_PLAYER_HUD_MIN_WIDTH_PX = 272;
export const PLAYER_HUD_HAND_GAP_PX = 8;
export const SELF_PLAYER_HUD_EDGE_INSET_PX = 12;
export const PLAYER_HUD_COMPACT_HEIGHT_PX = 176;

// Above this y a capsule is a top-anchored opponent, so its tooltip drops below
// the badge instead of rising above it (off the top edge).
const ANCHOR_BELOW_Y = 200;

export class PlayerHudLayer {
  readonly container: Container;
  private theme: Theme;
  private onTarget: (playerId: string) => void;
  private onShowSheet: (playerId: string) => void;
  private onMenu: () => void;
  private onInspect: (playerId: string) => void;
  private capsules = new Map<string, PlayerHudCapsule>();
  private tooltip: PlayerHudTooltip;
  private compact = false;

  constructor(
    theme: Theme,
    onTarget: (playerId: string) => void,
    onShowSheet: (playerId: string) => void,
    onMenu: () => void,
    onInspect: (playerId: string) => void,
  ) {
    this.theme = theme;
    this.onTarget = onTarget;
    this.onShowSheet = onShowSheet;
    this.onMenu = onMenu;
    this.onInspect = onInspect;
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
          () => this.onInspect(spec.playerId),
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
    bottomDocked = false,
  ): void {
    this.capsules.get(playerId)?.setRect(x, y, width, height, column, bottomDocked);
  }

  setCompact(compact: boolean): void {
    if (this.compact === compact) return;
    this.compact = compact;
    for (const capsule of this.capsules.values()) capsule.setCompact(compact);
  }

  getPlayerAnchor(playerId: string): ScreenPos | null {
    return this.capsules.get(playerId)?.getAvatarCenter() ?? null;
  }

  tick(): void {
    for (const capsule of this.capsules.values()) capsule.refreshMotion();
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

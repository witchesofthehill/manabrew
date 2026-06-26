import type { GameThemeColors } from "@/themes/gameTheme";
import type { PlayerHudBadge } from "@/pixi/hud/playerHud.types";

export interface PlayerHudBadgeFlags {
  isMonarch: boolean;
  hasInitiative: boolean;
  poison: number;
  energy: number;
  radiation: number;
  cmdDamage: number;
  cityBlessing: boolean;
  ringLevel: number;
  speed: number;
  handCount: number;
}

/** Mirrors the legacy React `PlayerPanel` badge list: which player/game badges
 *  surface, in what order, with which theme colour. Pure — no React, no theme
 *  hook — so the Pixi HUD and any preview share one source of truth. */
export function buildPlayerHudBadges(
  f: PlayerHudBadgeFlags,
  badges: GameThemeColors["badges"],
): PlayerHudBadge[] {
  const out: PlayerHudBadge[] = [];
  out.push({ id: "hand", icon: "card-pickup", color: badges.hand, count: f.handCount });
  if (f.isMonarch) out.push({ id: "monarch", icon: "crown", color: badges.monarch });
  if (f.hasInitiative)
    out.push({ id: "initiative", icon: "rolled-cloth", color: badges.initiative });
  if (f.poison > 0)
    out.push({ id: "poison", icon: "poison-bottle", color: badges.poison, count: f.poison });
  if (f.energy > 0)
    out.push({ id: "energy", icon: "lightning-trio", color: badges.energy, count: f.energy });
  if (f.cmdDamage > 0)
    out.push({
      id: "cmd-dmg",
      icon: "crossed-swords",
      color: badges.commanderDamage,
      count: f.cmdDamage,
    });
  if (f.radiation > 0)
    out.push({ id: "radiation", icon: "radioactive", color: badges.radiation, count: f.radiation });
  if (f.cityBlessing)
    out.push({ id: "city-blessing", icon: "stone-tower", color: badges.cityBlessing });
  if (f.ringLevel > 0)
    out.push({ id: "ring", icon: "ring", color: badges.ring, count: f.ringLevel });
  if (f.speed > 0)
    out.push({ id: "speed", icon: "speedometer", color: badges.speed, count: f.speed });
  return out;
}

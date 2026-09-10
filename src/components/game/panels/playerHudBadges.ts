import type { GameThemeColors } from "@/themes/gameTheme";
import type { PlayerHudBadge } from "@/pixi/hud/playerHud.types";
import type { ZoneTileSpec } from "@/pixi/board/BoardZoneTiles";
import { ZONE_BADGES, zoneBadgeId } from "@/components/game/game.constants";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export interface PlayerHudBadgeFlags {
  isMonarch: boolean;
  hasInitiative: boolean;
  poison: number;
  energy: number;
  radiation: number;
  experience: number;
  ticket: number;
  cityBlessing: boolean;
  enduringStory: boolean;
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
  out.push({
    id: "hand",
    icon: "card-pickup",
    color: badges.hand,
    get label() {
      return i18n._(msg`Cards in Hand`);
    },
    count: f.handCount,
  });
  if (f.isMonarch)
    out.push({
      id: "monarch",
      icon: "crown",
      color: badges.monarch,
      get label() {
        return i18n._(msg`Monarch`);
      },
    });
  if (f.hasInitiative)
    out.push({
      id: "initiative",
      icon: "rolled-cloth",
      color: badges.initiative,
      get label() {
        return i18n._(msg`Initiative`);
      },
    });
  if (f.poison > 0)
    out.push({
      id: "poison",
      icon: "poison-bottle",
      color: badges.poison,
      get label() {
        return i18n._(msg`Poison Counters`);
      },
      count: f.poison,
    });
  if (f.energy > 0)
    out.push({
      id: "energy",
      icon: "lightning-trio",
      color: badges.energy,
      get label() {
        return i18n._(msg`Energy Counters`);
      },
      count: f.energy,
    });
  if (f.radiation > 0)
    out.push({
      id: "radiation",
      icon: "radioactive",
      color: badges.radiation,
      get label() {
        return i18n._(msg`Radiation Counters`);
      },
      count: f.radiation,
    });
  if (f.experience > 0)
    out.push({
      id: "experience",
      icon: "star-medal",
      color: badges.experience,
      get label() {
        return i18n._(msg`Experience Counters`);
      },
      count: f.experience,
    });
  if (f.ticket > 0)
    out.push({
      id: "ticket",
      icon: "ticket",
      color: badges.ticket,
      get label() {
        return i18n._(msg`Ticket Counters`);
      },
      count: f.ticket,
    });
  if (f.cityBlessing)
    out.push({
      id: "city-blessing",
      icon: "stone-tower",
      color: badges.cityBlessing,
      get label() {
        return i18n._(msg`City's Blessing`);
      },
    });
  if (f.enduringStory)
    out.push({
      id: "enduring-story",
      icon: "scroll-unfurled",
      color: badges.enduringStory,
      get label() {
        return i18n._(msg`An Enduring Story`);
      },
    });
  if (f.ringLevel > 0)
    out.push({
      id: "ring",
      icon: "ring",
      color: badges.ring,
      get label() {
        return i18n._(msg`The Ring tempts you`);
      },
      count: f.ringLevel,
    });
  if (f.speed > 0)
    out.push({
      id: "speed",
      icon: "speedometer",
      color: badges.speed,
      get label() {
        return i18n._(msg`Speed`);
      },
      count: f.speed,
    });
  return out;
}
export function buildZoneBadges(tiles: ZoneTileSpec[], fallbackColor: string): PlayerHudBadge[] {
  return tiles.flatMap((t) => {
    const badge = ZONE_BADGES[t.key];
    return badge
      ? [
          {
            id: zoneBadgeId(t.key),
            icon: badge.icon,
            color: t.highlightColor ?? fallbackColor,
            label: badge.label,
            count: t.count,
            onTap: t.onOpen,
            zone: true,
          },
        ]
      : [];
  });
}

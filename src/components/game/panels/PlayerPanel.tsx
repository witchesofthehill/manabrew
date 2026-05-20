import { useMemo } from "react";
import type { GameCard, Player } from "@/types/manabrew";
import { cn } from "@/lib/utils";
import { GameIcon } from "@/components/game/GameIcon";
import { ManaPool as ManaPoolDisplay } from "./ManaPool";
import { PlayerAvatar } from "./PlayerAvatar";
import { ZoneActionColumn } from "@/components/game/ZoneActionColumn";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import type { OrbitBadge } from "./BadgeOrbit";
import type { ZonePanelItem } from "@/stores/usePreferencesStore";
import { useGameDevStore } from "@/stores/useGameDevStore";
import type { PlayerSeat } from "../game.types";

interface PlayerPanelProps {
  player: Player;
  isOpponent: boolean;
  /** Seat identifier used to pick the per-player theme colour. */
  seat: PlayerSeat;
  className?: string;
  /** `bottom` = avatar anchored at the bottom of the cluster (local player); zones row sits on top. `top` = opponent mirror. */
  /** Retained for backwards compat with existing callers but no longer
   *  alters layout — the badge/mana row always sits above the avatar
   *  and zones. */
  verticalAlign?: "top" | "bottom";
  isActiveTurn?: boolean;
  isPriorityPlayer?: boolean;
  isTargetable?: boolean;
  isSelectedTarget?: boolean;
  onTarget?: () => void;
  isFlashing?: boolean;
  isMonarch?: boolean;
  hasInitiative?: boolean;
  commanders?: GameCard[];
  graveyard?: GameCard[];
  exile?: GameCard[];
  onOpenCommandZone?: () => void;
  onCastCommander?: (cardId: string) => void;
  onCommanderDragStart?: (card: GameCard, e: React.MouseEvent) => void;
  draggingCardId?: string | null;
  onHoverCard?: (card: GameCard | null, e?: React.MouseEvent) => void;
  onOpenLibrary?: () => void;
  onOpenGraveyard?: () => void;
  onOpenExile?: () => void;
  hasPlayableInGraveyard?: boolean;
  hasPlayableInExile?: boolean;
  zonePanelOrder?: ZonePanelItem[];
}

export function PlayerPanel({
  player,
  isOpponent,
  seat,
  className,
  verticalAlign: _verticalAlign = "bottom",
  isActiveTurn,
  isPriorityPlayer: _isPriorityPlayer,
  isTargetable,
  isSelectedTarget,
  onTarget,
  isFlashing,
  isMonarch,
  hasInitiative,
  commanders,
  graveyard,
  exile,
  onOpenCommandZone,
  onCastCommander,
  onCommanderDragStart,
  draggingCardId,
  onHoverCard,
  onOpenLibrary,
  onOpenGraveyard,
  onOpenExile,
  hasPlayableInGraveyard,
  hasPlayableInExile,
  zonePanelOrder,
}: PlayerPanelProps) {
  const themeColors = useTheme().gameTheme;
  const fontSizes = useTheme().gameTheme.fontSizes;
  const devOverrides = useGameDevStore((s) => s.playerOverrides);

  // Dev-only substitutions applied to the local player so the operator
  // can inspect every badge/visual state without a real game driving it.
  const applyOverride = !isOpponent;
  const effectiveIsMonarch = applyOverride && devOverrides.forceMonarch ? true : isMonarch;
  const effectiveHasInitiative =
    applyOverride && devOverrides.forceInitiative ? true : hasInitiative;
  const effectiveCityBlessing =
    applyOverride && devOverrides.forceCityBlessing ? true : (player.hasCityBlessing ?? false);
  const effectivePoison =
    applyOverride && devOverrides.poison != null ? devOverrides.poison : player.poison;
  const effectiveEnergy =
    applyOverride && devOverrides.energy != null
      ? devOverrides.energy
      : (player.energyCounters ?? 0);
  const effectiveRadiation =
    applyOverride && devOverrides.radiation != null
      ? devOverrides.radiation
      : (player.radiationCounters ?? 0);
  const effectiveRingLevel =
    applyOverride && devOverrides.ringLevel != null
      ? devOverrides.ringLevel
      : (player.ringLevel ?? 0);
  const effectiveSpeed =
    applyOverride && devOverrides.speed != null ? devOverrides.speed : (player.speed ?? 0);
  const effectiveLife =
    applyOverride && devOverrides.life != null ? devOverrides.life : player.life;
  const effectiveHandCount =
    applyOverride && devOverrides.handCount != null ? devOverrides.handCount : player.handCount;

  const realCmdDmg = Object.values(player.commanderDamage ?? {}).reduce((a, b) => a + b, 0);
  const totalCmdDmg =
    applyOverride && devOverrides.cmdDamage != null ? devOverrides.cmdDamage : realCmdDmg;

  // Effective player view — dev overrides flow into PlayerAvatar (life)
  // + ManaPoolDisplay (handCount) without mutating the upstream object.
  const effectivePlayer: Player = {
    ...player,
    life: effectiveLife,
    handCount: effectiveHandCount,
    poison: effectivePoison,
    energyCounters: effectiveEnergy,
  };

  // NOT IMPLEMENTED: experience counters and ticket counters are not
  // tracked on the engine `PlayerState` yet, so no badge exists for
  // them. Add a field to `PlayerState` + `PlayerDto` + `Player` (TS)
  // and drop a branch below to surface them as badges.
  //
  // Hand is the only badge that orbits the avatar — the rest move to a
  // row below (next to the mana pool) so the avatar stays uncluttered.
  const orbitBadges = useMemo<OrbitBadge[]>(
    () => [
      {
        id: "hand",
        icon: <GameIcon name="card-pickup" className="h-3.5 w-3.5" />,
        label: "Cards in Hand",
        count: effectiveHandCount,
        color: withAlpha(themeColors.promptAction.cancel, 0.85),
      },
    ],
    [effectiveHandCount, themeColors],
  );

  const rowBadges = useMemo<OrbitBadge[]>(() => {
    const out: OrbitBadge[] = [];
    if (effectiveIsMonarch) {
      out.push({
        id: "monarch",
        icon: <GameIcon name="crown" className="h-[18px] w-[18px]" />,
        label: "Monarch",
        color: themeColors.badges.monarch,
      });
    }
    if (effectiveHasInitiative) {
      out.push({
        id: "initiative",
        icon: <GameIcon name="rolled-cloth" className="h-[18px] w-[18px]" />,
        label: "Initiative",
        color: themeColors.badges.initiative,
      });
    }
    if (effectivePoison > 0) {
      out.push({
        id: "poison",
        icon: <GameIcon name="poison-bottle" className="h-[18px] w-[18px]" />,
        label: "Poison Counters",
        count: effectivePoison,
        color: themeColors.badges.poison,
      });
    }
    if (effectiveEnergy > 0) {
      out.push({
        id: "energy",
        icon: <GameIcon name="lightning-trio" className="h-[18px] w-[18px]" />,
        label: "Energy Counters",
        count: effectiveEnergy,
        color: themeColors.badges.energy,
      });
    }
    if (totalCmdDmg > 0) {
      out.push({
        id: "cmd-dmg",
        icon: <GameIcon name="crossed-swords" className="h-[18px] w-[18px]" />,
        label: "Commander Damage Taken",
        count: totalCmdDmg,
        color: themeColors.badges.commanderDamage,
      });
    }
    if (effectiveRadiation > 0) {
      out.push({
        id: "radiation",
        icon: <GameIcon name="radioactive" className="h-[18px] w-[18px]" />,
        label: "Radiation Counters",
        count: effectiveRadiation,
        color: themeColors.badges.radiation,
      });
    }
    if (effectiveCityBlessing) {
      out.push({
        id: "city-blessing",
        icon: <GameIcon name="stone-tower" className="h-[18px] w-[18px]" />,
        label: "City's Blessing",
        color: themeColors.badges.cityBlessing,
      });
    }
    if (effectiveRingLevel > 0) {
      out.push({
        id: "ring",
        icon: <GameIcon name="ring" className="h-[18px] w-[18px]" />,
        label: "The Ring tempts you",
        count: effectiveRingLevel,
        color: themeColors.badges.ring,
      });
    }
    if (effectiveSpeed > 0) {
      out.push({
        id: "speed",
        icon: <GameIcon name="speedometer" className="h-[18px] w-[18px]" />,
        label: "Speed",
        count: effectiveSpeed,
        color: themeColors.badges.speed,
      });
    }
    return out;
  }, [
    effectiveIsMonarch,
    effectiveHasInitiative,
    effectiveCityBlessing,
    effectivePoison,
    effectiveEnergy,
    effectiveRadiation,
    effectiveRingLevel,
    effectiveSpeed,
    totalCmdDmg,
    themeColors,
  ]);

  const seatColor = themeColors.playerColors[seat];

  const avatarCell = (
    <div className="h-[100px] flex items-center justify-center pointer-events-auto w-fit shrink-0">
      <PlayerAvatar
        player={effectivePlayer}
        badges={orbitBadges}
        seatColor={seatColor}
        isActiveTurn={isActiveTurn}
        isTargetable={isTargetable}
        isSelectedTarget={isSelectedTarget}
        onTarget={onTarget}
        isFlashing={isFlashing}
      />
    </div>
  );

  // Avatar is rendered as the `leading` flex item inside
  // ZoneActionColumn so it shares the same `flex-wrap` row as the zone
  // tiles — when the cluster narrows, the avatar wraps onto its own
  // row above the zones automatically.
  const zonesRow = (
    <ZoneActionColumn
      orientation="horizontal"
      wrap={!isOpponent}
      libraryCount={player.libraryCount}
      graveyard={graveyard}
      exile={exile}
      order={zonePanelOrder}
      onOpenLibrary={onOpenLibrary}
      onOpenGraveyard={onOpenGraveyard}
      onOpenExile={onOpenExile}
      hasPlayableInGraveyard={hasPlayableInGraveyard}
      hasPlayableInExile={hasPlayableInExile}
      commanders={commanders}
      onOpenCommandZone={onOpenCommandZone}
      onCastCommander={onCastCommander}
      onCommanderDragStart={onCommanderDragStart}
      draggingCardId={draggingCardId}
      onHoverCard={onHoverCard}
      leading={avatarCell}
    />
  );

  const manaRow = (
    <div className="flex h-7 w-fit items-center justify-start gap-2 px-1 pointer-events-auto">
      {rowBadges.length > 0 && (
        <div className="flex items-center gap-1.5">
          {rowBadges.map((b) => (
            <span
              key={b.id}
              title={b.label}
              className="inline-flex items-center gap-0.5"
              style={{ color: b.color }}
            >
              <span className="inline-flex items-center">{b.icon}</span>
              {b.count !== undefined && (
                <span
                  className="font-extrabold leading-none tabular-nums"
                  style={{ fontSize: fontSizes.badgeCount }}
                >
                  {b.count}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      <ManaPoolDisplay pool={player.manaPool} />
    </div>
  );

  return (
    <div
      className={cn(
        // Flex-col keeps mana+badges stacked above the avatar/zones
        // cluster. The zones cluster itself is a `flex-wrap` row
        // (ZoneActionColumn, horizontal) that hosts the avatar as its
        // first item — so on narrow widths the avatar and zone tiles
        // wrap together instead of being locked into a rigid 2-col
        // grid.
        "flex w-full flex-col gap-1 min-w-0",
        className,
      )}
    >
      {manaRow}
      {zonesRow}
    </div>
  );
}

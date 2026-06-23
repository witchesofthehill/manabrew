import { useState, type CSSProperties } from "react";
import type { Player } from "@/types/manabrew";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart } from "lucide-react";
import { getInitials } from "../game.utils";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { BadgeOrbit, type OrbitBadge } from "./BadgeOrbit";

export interface PlayerAvatarProps {
  player: Player;
  badges: OrbitBadge[];
  seatColor: string;
  avatarUrl?: string;
  isActiveTurn?: boolean;
  isPriorityPlayer?: boolean;
  isTargetable?: boolean;
  isSelectedTarget?: boolean;
  onTarget?: () => void;
  isFlashing?: boolean;
  className?: string;
}

const AVATAR_PX = 72;
const LIFE_FLOAT_MIN_PX = 22;
const LIFE_FLOAT_STEP_PX = 5;

export function PlayerAvatar({
  player,
  badges,
  seatColor,
  avatarUrl,
  isActiveTurn,
  isPriorityPlayer,
  isTargetable,
  isSelectedTarget,
  onTarget,
  isFlashing,
  className,
}: PlayerAvatarProps) {
  const theme = useTheme();
  const themeColors = theme.gameTheme;
  const fontSizes = theme.gameTheme.fontSizes;

  // Bumping a key remounts the badge so the one-shot CSS animation replays.
  const [prevLife, setPrevLife] = useState(player.life);
  const [lifeLossKey, setLifeLossKey] = useState(0);
  const [lifeFloatKey, setLifeFloatKey] = useState(0);
  const [lifeDelta, setLifeDelta] = useState(0);
  if (player.life !== prevLife) {
    if (player.life < prevLife) setLifeLossKey((k) => k + 1);
    setLifeDelta(player.life - prevLife);
    setLifeFloatKey((k) => k + 1);
    setPrevLife(player.life);
  }
  const lifeFloatSize = Math.min(
    AVATAR_PX,
    LIFE_FLOAT_MIN_PX + Math.abs(lifeDelta) * LIFE_FLOAT_STEP_PX,
  );
  const targetableColor = withAlpha(themeColors.promptAction.attackAction, 0.9);
  const selectedTargetColor = themeColors.promptAction.attackAction;
  const priorityColor = themeColors.activeAction.priority;
  const showPriority = !!isPriorityPlayer && !isTargetable && !isSelectedTarget;

  const ringStyle: CSSProperties = isSelectedTarget
    ? {
        boxShadow: `0 0 0 3px ${selectedTargetColor}, 0 0 14px ${withAlpha(selectedTargetColor, 0.7)}`,
      }
    : isTargetable
      ? { boxShadow: `0 0 0 2px ${targetableColor}` }
      : isActiveTurn
        ? { boxShadow: `0 0 0 2px ${seatColor}, 0 0 16px ${withAlpha(seatColor, 0.75)}` }
        : {};

  return (
    <div
      className={cn("relative inline-flex flex-col items-center gap-0.5", className)}
      data-player-id={player.id}
    >
      {lifeFloatKey > 0 && (
        <span
          key={lifeFloatKey}
          aria-hidden
          className="animate-life-float pointer-events-none absolute left-1/2 top-0 z-40 font-extrabold leading-none tabular-nums"
          style={{
            color: lifeDelta < 0 ? themeColors.pt.lethal : themeColors.life,
            fontSize: lifeFloatSize,
            textShadow: "0 1px 3px rgba(0, 0, 0, 0.85)",
          }}
        >
          {lifeDelta > 0 ? `+${lifeDelta}` : lifeDelta}
        </span>
      )}
      <div
        className="relative"
        style={{ width: AVATAR_PX, height: AVATAR_PX }}
        onClick={isTargetable ? onTarget : undefined}
        title={isTargetable ? `Target ${player.name}` : player.name}
      >
        <Avatar
          className={cn(
            "h-full w-full",
            isTargetable && "cursor-pointer animate-player-targetable-pulse",
            isFlashing && "animate-player-turn-flash",
          )}
          style={{
            ...ringStyle,
            ...(isFlashing ? ({ "--turn-flash-color": seatColor } as CSSProperties) : {}),
            ...(isTargetable || isSelectedTarget
              ? ({
                  "--targetable-color": targetableColor,
                  "--tw-ring-color": selectedTargetColor,
                } as CSSProperties)
              : {}),
          }}
        >
          {avatarUrl && <AvatarImage src={avatarUrl} alt={player.name} />}
          <AvatarFallback
            className="font-bold text-white"
            style={{ backgroundColor: seatColor, fontSize: fontSizes.avatarInitials }}
          >
            {getInitials(player.name)}
          </AvatarFallback>
        </Avatar>

        {lifeLossKey > 0 && (
          <span
            key={lifeLossKey}
            aria-hidden
            className="animate-life-damage-wash pointer-events-none absolute inset-0 z-20 rounded-full"
            style={{
              background: `radial-gradient(circle at 50% 50%, transparent 48%, ${withAlpha(
                themeColors.pt.lethal,
                0.55,
              )} 100%)`,
            }}
          />
        )}

        {showPriority && (
          <span
            aria-label={`Waiting on ${player.name}`}
            className="pointer-events-none absolute inset-0 z-20 rounded-full animate-player-priority-pulse"
            style={{ "--priority-color": priorityColor } as CSSProperties}
          />
        )}

        <div className="pointer-events-none absolute left-1/2 -bottom-2 -translate-x-1/2 z-30">
          <span
            key={lifeLossKey}
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-white shadow ring-1 ring-black/50",
              lifeLossKey > 0 && "animate-life-flash",
            )}
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.82)",
              ...({ "--life-flash-color": themeColors.pt.lethal } as CSSProperties),
            }}
          >
            <Heart
              className="h-3.5 w-3.5"
              style={{ color: themeColors.life, fill: themeColors.life }}
            />
            <span
              className="font-extrabold leading-none tabular-nums"
              style={{ fontSize: fontSizes.life }}
            >
              {player.life}
            </span>
          </span>
        </div>

        <BadgeOrbit badges={badges} avatarSize={AVATAR_PX} />
      </div>
    </div>
  );
}

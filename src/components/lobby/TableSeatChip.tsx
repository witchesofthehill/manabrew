import type { CSSProperties } from "react";
import { Bot, Crown, Plus, User, X } from "lucide-react";
import { usePlayerAvatar } from "@/hooks/usePlayerAvatar";
import { stripUsernameTag } from "@/lib/username";
import { cn } from "@/lib/utils";
import type { RoomPlayerInfo } from "@/types/server";

function seatInitials(username: string) {
  return stripUsernameTag(username).slice(0, 2).toUpperCase();
}

interface TableSeatChipProps {
  seatIndex: number;
  player?: RoomPlayerInfo;
  isHost: boolean;
  joinable?: boolean;
  onTakeSeat?: () => void;
  ready?: boolean;
  isYou?: boolean;
  onRemove?: () => void;
  nameLabel?: string;
  statusLabel?: string;
  size?: "card" | "room";
  style?: CSSProperties;
  className?: string;
}

export function TableSeatChip({
  seatIndex,
  player,
  isHost,
  joinable = false,
  onTakeSeat,
  ready = false,
  isYou = false,
  onRemove,
  nameLabel,
  statusLabel,
  size = "card",
  style,
  className,
}: TableSeatChipProps) {
  const avatarUrl = usePlayerAvatar(player?.username);
  if (!player) {
    if (!joinable) {
      return (
        <div
          role="img"
          title="Open seat"
          aria-label={`Seat ${seatIndex + 1}: open`}
          style={style}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-border/70 bg-card text-muted-foreground/40",
            size === "room" && "h-12 w-12 sm:h-14 sm:w-14",
            className,
          )}
        >
          <User
            aria-hidden="true"
            className={cn("h-3.5 w-3.5", size === "room" && "h-5 w-5 sm:h-6 sm:w-6")}
          />
        </div>
      );
    }
    return (
      <button
        type="button"
        title="Take this seat"
        aria-label={`Take seat ${seatIndex + 1}`}
        onClick={onTakeSeat}
        style={style}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-primary/50 bg-card text-primary/70 shadow-sm transition-[transform,background-color,border-color] hover:scale-110 hover:border-primary hover:bg-primary/15 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:scale-100",
          size === "room" && "h-12 w-12 sm:h-14 sm:w-14",
          className,
        )}
      >
        <Plus
          aria-hidden="true"
          className={cn("h-4 w-4", size === "room" && "h-5 w-5 sm:h-6 sm:w-6")}
        />
      </button>
    );
  }

  const name = stripUsernameTag(player.username);
  const label = player.is_bot ? `${name} (bot)` : isHost ? `${name} (table host)` : name;
  const accessibleLabel = statusLabel ? `${label}, ${statusLabel}` : label;
  return (
    <div
      role="group"
      title={label}
      aria-label={`Seat ${seatIndex + 1}: ${accessibleLabel}`}
      style={style}
      className={cn("flex flex-col items-center gap-0.5", className)}
    >
      <div
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-card bg-card text-[10px] font-bold shadow-md",
          size === "room" && "h-12 w-12 text-xs sm:h-14 sm:w-14 sm:text-sm",
          player.is_bot ? "text-muted-foreground" : "text-primary",
          ready && "ring-2 ring-primary/70",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 rounded-full",
            player.is_bot ? "bg-muted" : "bg-primary/20",
          )}
        />
        {player.is_bot ? (
          <Bot
            aria-hidden="true"
            className={cn("relative h-3.5 w-3.5", size === "room" && "h-5 w-5 sm:h-6 sm:w-6")}
          />
        ) : avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full rounded-full object-cover"
          />
        ) : (
          <span className="relative">{seatInitials(player.username)}</span>
        )}
        {isHost && (
          <Crown
            aria-hidden="true"
            className={cn(
              "absolute -right-2 -top-2 h-4 w-4 rotate-[40deg] text-commander",
              size === "room" && "-right-2.5 -top-2.5 h-5 w-5 sm:-right-3 sm:-top-3 sm:h-6 sm:w-6",
            )}
          />
        )}
        {onRemove && (
          <button
            type="button"
            title="Remove bot"
            aria-label={`Remove ${name}`}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className="absolute -left-2.5 -top-2.5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-destructive pointer-coarse:-left-5 pointer-coarse:-top-5 pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <X aria-hidden="true" className="h-3 w-3" />
          </button>
        )}
      </div>
      {nameLabel && (
        <span
          className={cn(
            "max-w-16 truncate text-[10px] font-medium leading-tight",
            size === "room" && "hidden max-w-24 text-xs sm:block",
            isYou && "font-semibold text-primary",
          )}
        >
          {nameLabel}
        </span>
      )}
      {statusLabel && (
        <span
          className={cn(
            "max-w-16 truncate text-[9px] leading-tight text-muted-foreground",
            size === "room" && "hidden max-w-24 text-[10px] sm:block",
          )}
        >
          {statusLabel}
        </span>
      )}
    </div>
  );
}

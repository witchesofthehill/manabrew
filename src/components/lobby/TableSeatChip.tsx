import type { CSSProperties } from "react";
import { Armchair, Bot, Crown, Plus } from "lucide-react";
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
  style?: CSSProperties;
  className?: string;
}

export function TableSeatChip({
  seatIndex,
  player,
  isHost,
  joinable = false,
  onTakeSeat,
  style,
  className,
}: TableSeatChipProps) {
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
            className,
          )}
        >
          <Armchair aria-hidden="true" className="h-3.5 w-3.5" />
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
          className,
        )}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
    );
  }

  const name = stripUsernameTag(player.username);
  const label = player.is_bot ? `${name} (bot)` : isHost ? `${name} (table host)` : name;
  return (
    <div
      role="img"
      title={label}
      aria-label={`Seat ${seatIndex + 1}: ${label}`}
      style={style}
      className={cn(
        "relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-card text-[10px] font-bold shadow-md",
        player.is_bot ? "bg-muted text-muted-foreground" : "bg-primary/20 text-primary",
        className,
      )}
    >
      {player.is_bot ? (
        <Bot aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        seatInitials(player.username)
      )}
      {isHost && (
        <Crown aria-hidden="true" className="absolute -top-1.5 -right-1.5 h-3 w-3 text-commander" />
      )}
    </div>
  );
}

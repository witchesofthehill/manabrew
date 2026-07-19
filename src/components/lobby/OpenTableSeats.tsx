import type { CSSProperties } from "react";
import { Armchair, Bot, Crown, Users } from "lucide-react";
import { stripUsernameTag } from "@/lib/username";
import { cn } from "@/lib/utils";
import type { RoomPlayerInfo } from "@/types/server";

const SEAT_CENTER_PERCENT = 50;
const SEAT_X_RADIUS_PERCENT = 40;
const SEAT_Y_RADIUS_PERCENT = 36;
const SEAT_START_ANGLE = Math.PI / 2;

function seatStyle(index: number, total: number): CSSProperties {
  const angle = SEAT_START_ANGLE + (index * 2 * Math.PI) / total;
  return {
    left: `${SEAT_CENTER_PERCENT + SEAT_X_RADIUS_PERCENT * Math.cos(angle)}%`,
    top: `${SEAT_CENTER_PERCENT + SEAT_Y_RADIUS_PERCENT * Math.sin(angle)}%`,
  };
}

function seatInitials(username: string) {
  return stripUsernameTag(username).slice(0, 2).toUpperCase();
}

interface OpenTableSeatsProps {
  players: readonly RoomPlayerInfo[];
  maxPlayers: number;
}

export function OpenTableSeats({ players, maxPlayers }: OpenTableSeatsProps) {
  const controllerName = players.find((player) => !player.is_bot)?.username ?? players[0]?.username;

  return (
    <div
      role="group"
      aria-label={`Table seats: ${players.length} of ${maxPlayers} occupied`}
      className="relative mx-auto aspect-[8/5] w-full max-w-60"
    >
      <div className="absolute left-1/2 top-1/2 h-[64%] w-[76%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/60 bg-secondary/50" />
      <div className="absolute left-1/2 top-1/2 flex h-[46%] w-[62%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border/40 bg-muted/50 shadow-inner">
        <span
          aria-hidden="true"
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground"
        >
          <Users className="h-3 w-3" />
          {players.length}/{maxPlayers}
        </span>
      </div>
      {Array.from({ length: maxPlayers }, (_, seatIndex) => {
        const player = players[seatIndex];
        const style = seatStyle(seatIndex, maxPlayers);
        if (!player) {
          return (
            <div
              key={seatIndex}
              role="img"
              title="Open seat"
              aria-label={`Seat ${seatIndex + 1}: open`}
              style={style}
              className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-dashed border-border bg-card text-muted-foreground/50"
            >
              <Armchair aria-hidden="true" className="h-3.5 w-3.5" />
            </div>
          );
        }
        const isHostSeat = player.username === controllerName;
        const name = stripUsernameTag(player.username);
        const label = player.is_bot ? `${name} (bot)` : isHostSeat ? `${name} (table host)` : name;
        return (
          <div
            key={seatIndex}
            role="img"
            title={label}
            aria-label={`Seat ${seatIndex + 1}: ${label}`}
            style={style}
            className={cn(
              "absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[10px] font-semibold",
              player.is_bot
                ? "border-border bg-muted text-muted-foreground"
                : "border-primary/30 bg-primary/15 text-primary",
            )}
          >
            {player.is_bot ? (
              <Bot aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              seatInitials(player.username)
            )}
            {isHostSeat && (
              <Crown
                aria-hidden="true"
                className="absolute -top-1.5 -right-1.5 h-3 w-3 text-commander"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

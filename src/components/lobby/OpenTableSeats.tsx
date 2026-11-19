import type { CSSProperties, ReactNode } from "react";
import { TableSeatChip } from "@/components/lobby/TableSeatChip";
import { botAvatarUrls } from "@/lib/botAvatars";
import { stripUsernameTag } from "@/lib/username";
import type { RoomPlayerInfo } from "@/types/server";
import { cn } from "@/lib/utils";
const SEAT_CENTER_PERCENT = 50;
const SEAT_X_RADIUS_PERCENT = 40;
const SEAT_Y_RADIUS_PERCENT = 34;
const SEAT_START_ANGLE = Math.PI / 2;
function seatStyle(index: number, total: number): CSSProperties {
  const angle = SEAT_START_ANGLE + (index * 2 * Math.PI) / total;
  return {
    left: `${SEAT_CENTER_PERCENT + SEAT_X_RADIUS_PERCENT * Math.cos(angle)}%`,
    top: `${SEAT_CENTER_PERCENT + SEAT_Y_RADIUS_PERCENT * Math.sin(angle)}%`,
  };
}
interface OpenTableSeatsProps {
  players: readonly RoomPlayerInfo[];
  maxPlayers: number;
  joinable?: boolean;
  onTakeSeat?: () => void;
  centerContent?: ReactNode;
  showSeatLabels?: boolean;
  openFormat?: boolean;
  youUsername?: string | null;
  removableBots?: readonly string[];
  onRemoveBot?: (username: string) => void;
  selectedUsername?: string | null;
  onSelectSeat?: (username: string) => void;
  onAddBot?: (seatIndex: number) => void;
  onInvitePlayer?: () => void;
  size?: "card" | "room";
  ornamental?: boolean;
  className?: string;
  backgroundUrl?: string | null;
}
export function OpenTableSeats({
  players,
  maxPlayers,
  joinable = false,
  onTakeSeat,
  centerContent,
  showSeatLabels = false,
  openFormat = false,
  youUsername,
  removableBots = [],
  onRemoveBot,
  selectedUsername,
  onSelectSeat,
  onAddBot,
  onInvitePlayer,
  size = "card",
  ornamental = false,
  className,
  backgroundUrl,
}: OpenTableSeatsProps) {
  const controllerName = players.find((player) => !player.is_bot)?.username ?? players[0]?.username;
  const botAvatars = botAvatarUrls(players);
  return (
    <div
      role="group"
      aria-label={`Table seats: ${players.length} of ${maxPlayers} occupied`}
      className={cn("relative mx-auto aspect-[8/5] w-full max-w-64", className)}
    >
      <div
        className={cn(
          "absolute left-1/2 top-1/2 h-[68%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-inner",
          ornamental ? "border-border bg-card" : "border-primary/25",
          !ornamental && (backgroundUrl === null ? "bg-canvas-background" : "bg-primary/[0.07]"),
        )}
        style={
          backgroundUrl
            ? {
                backgroundImage: `url(${backgroundUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      />
      {centerContent && (
        <div className="absolute left-1/2 top-1/2 flex h-[48%] w-[60%] -translate-x-1/2 -translate-y-1/2 items-center justify-center text-center">
          <div
            className={cn(
              !ornamental &&
                backgroundUrl !== undefined &&
                "rounded-lg border border-border bg-background px-3 py-2 text-foreground shadow-sm",
            )}
          >
            {centerContent}
          </div>
        </div>
      )}
      {Array.from({ length: maxPlayers }, (_, seatIndex) => {
        const player = players.find(
          (candidate, index) => (candidate.seat_index ?? index) === seatIndex,
        );
        const isControllerSeat = player?.username === controllerName;
        const statusLabel =
          showSeatLabels && player
            ? openFormat
              ? isControllerSeat
                ? `Host`
                : player.ready
                  ? `Ready`
                  : `Waiting`
              : (player.selected_deck_name ?? `Choose deck`)
            : undefined;
        return (
          <TableSeatChip
            key={seatIndex}
            seatIndex={seatIndex}
            player={player}
            botAvatarUrl={player ? botAvatars.get(player.username) : undefined}
            isHost={isControllerSeat}
            joinable={joinable}
            onTakeSeat={onTakeSeat}
            onAddBot={onAddBot ? () => onAddBot(seatIndex) : undefined}
            onInvitePlayer={onInvitePlayer}
            selected={player?.username === selectedUsername}
            onSelect={
              onSelectSeat &&
              player &&
              (player.username === youUsername || removableBots.includes(player.username))
                ? () => onSelectSeat(player.username)
                : undefined
            }
            ready={player ? player.ready || isControllerSeat : false}
            isYou={!!youUsername && player?.username === youUsername}
            onRemove={
              player && removableBots.includes(player.username)
                ? () => onRemoveBot?.(player.username)
                : undefined
            }
            nameLabel={showSeatLabels && player ? stripUsernameTag(player.username) : undefined}
            statusLabel={statusLabel}
            size={size}
            style={seatStyle(seatIndex, maxPlayers)}
            className="absolute -translate-x-1/2 -translate-y-1/2"
          />
        );
      })}
    </div>
  );
}

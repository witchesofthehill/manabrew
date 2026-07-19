import type { CSSProperties, ReactNode } from "react";
import { TableSeatChip } from "@/components/lobby/TableSeatChip";
import type { RoomPlayerInfo } from "@/types/server";

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
}

export function OpenTableSeats({
  players,
  maxPlayers,
  joinable = false,
  onTakeSeat,
  centerContent,
}: OpenTableSeatsProps) {
  const controllerName = players.find((player) => !player.is_bot)?.username ?? players[0]?.username;

  return (
    <div
      role="group"
      aria-label={`Table seats: ${players.length} of ${maxPlayers} occupied`}
      className="relative mx-auto aspect-[8/5] w-full max-w-64"
    >
      <div className="absolute left-1/2 top-1/2 h-[68%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary/25 bg-primary/[0.07] shadow-inner" />
      <div className="absolute left-1/2 top-1/2 flex h-[48%] w-[60%] -translate-x-1/2 -translate-y-1/2 items-center justify-center text-center">
        {centerContent}
      </div>
      {Array.from({ length: maxPlayers }, (_, seatIndex) => (
        <TableSeatChip
          key={seatIndex}
          seatIndex={seatIndex}
          player={players[seatIndex]}
          isHost={players[seatIndex]?.username === controllerName}
          joinable={joinable}
          onTakeSeat={onTakeSeat}
          style={seatStyle(seatIndex, maxPlayers)}
          className="absolute -translate-x-1/2 -translate-y-1/2"
        />
      ))}
    </div>
  );
}

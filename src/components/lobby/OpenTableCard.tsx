import { BadgeCheck, LockKeyhole, UserRoundPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EngineMark } from "@/components/lobby/EngineMark";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import { getFormat } from "@/lib/formats";
import { stripUsernameTag } from "@/lib/username";
import { cn } from "@/lib/utils";
import { PROTOCOL_VERSION } from "@/protocol";
import type { RoomInfo } from "@/types/server";

interface OpenTableCardProps {
  room: RoomInfo;
  currentRoomId: string | null;
  joining: boolean;
  onJoin: (room: RoomInfo) => void;
}

export function OpenTableCard({ room, currentRoomId, joining, onJoin }: OpenTableCardProps) {
  const isMyRoom = room.room_id === currentRoomId;
  const isCompatible = room.protocol_version === PROTOCOL_VERSION;
  const isFull = room.players.length >= room.max_players;
  const canJoin = isCompatible && currentRoomId == null && room.status === "Lobby" && !isFull;
  const format = getFormat(room.format.toLowerCase());
  const modeLabel = format?.name ?? room.format;
  const limitedLabel = room.draft_config
    ? (room.draft_config.cube_name ?? room.draft_config.set_code)
    : room.sealed_config
      ? room.sealed_config.set_code
      : null;
  const showHost = !room.official && !room.hosted;

  return (
    <article
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border bg-card p-3 shadow-sm motion-safe:transition-colors",
        isMyRoom && "border-primary/40 bg-primary/5",
        !isMyRoom && canJoin && "hover:border-primary/40",
        !isCompatible && "opacity-60",
      )}
    >
      <div className="flex items-center gap-1.5">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{room.room_name}</h3>
        {room.official && (
          <span
            role="img"
            aria-label="Official table"
            title="Official table"
            className="inline-flex shrink-0"
          >
            <BadgeCheck aria-hidden="true" className="h-4 w-4 text-primary" />
          </span>
        )}
        {room.password_protected && (
          <span
            role="img"
            aria-label="Password-protected table"
            title="Password-protected table"
            className="inline-flex shrink-0"
          >
            <LockKeyhole aria-hidden="true" className="h-3.5 w-3.5 text-format-badge-amber" />
          </span>
        )}
        {!isCompatible && (
          <span className="inline-flex items-center rounded bg-format-badge-rose/15 px-2 py-0.5 text-xs font-semibold leading-tight text-format-badge-rose">
            Incompatible
          </span>
        )}
      </div>
      {showHost && (
        <p className="-mt-1.5 truncate text-[11px] text-muted-foreground">
          Hosted by {stripUsernameTag(room.host)}
        </p>
      )}

      <OpenTableSeats
        players={room.players}
        maxPlayers={room.max_players}
        joinable={canJoin}
        onTakeSeat={() => onJoin(room)}
        centerContent={
          <span className="flex flex-col items-center gap-0.5">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-foreground/85">
              <EngineMark engine={room.engine} className="h-3 w-3" />
              {room.engine}
            </span>
            <span className="max-w-28 truncate text-[10px] text-muted-foreground">
              {limitedLabel ?? modeLabel}
            </span>
          </span>
        }
      />

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users aria-hidden="true" className="h-3.5 w-3.5" />
          {room.players.length}/{room.max_players} seated
        </span>
        {isMyRoom ? (
          <Badge variant="secondary" className="text-[10px]">
            Seated
          </Badge>
        ) : canJoin ? (
          <Button
            size="sm"
            className="gap-1.5"
            disabled={joining}
            aria-busy={joining}
            onClick={() => onJoin(room)}
          >
            <UserRoundPlus aria-hidden="true" className="h-3.5 w-3.5" />
            {joining ? "Joining…" : "Take a seat"}
          </Button>
        ) : room.status === "InGame" ? (
          <span className="text-xs text-muted-foreground">Playing</span>
        ) : isFull ? (
          <span className="text-xs text-muted-foreground">Full</span>
        ) : null}
      </div>
    </article>
  );
}

import type { ReactNode } from "react";
import { Anvil, BadgeCheck, Cpu, LockKeyhole, UserRoundPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GameIcon } from "@/components/game/GameIcon";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import { getFormat } from "@/lib/formats";
import { stripUsernameTag } from "@/lib/username";
import { cn } from "@/lib/utils";
import { PROTOCOL_VERSION } from "@/protocol";
import type { RoomInfo } from "@/types/server";

const TABLE_TAG_CLASSES: Record<string, string> = {
  blue: "bg-format-badge-blue/15 text-format-badge-blue",
  amber: "bg-format-badge-amber/15 text-format-badge-amber",
  emerald: "bg-format-badge-emerald/15 text-format-badge-emerald",
  rose: "bg-format-badge-rose/15 text-format-badge-rose",
  slate: "bg-format-badge-slate/15 text-format-badge-slate",
  zinc: "bg-format-badge-zinc/15 text-format-badge-zinc",
  purple: "bg-format-badge-purple/15 text-format-badge-purple",
  teal: "bg-format-badge-teal/15 text-format-badge-teal",
  orange: "bg-format-badge-orange/15 text-format-badge-orange",
  sky: "bg-format-badge-sky/15 text-format-badge-sky",
  indigo: "bg-format-badge-indigo/15 text-format-badge-indigo",
  neutral: "bg-muted text-muted-foreground",
};

function TableTag({
  tone,
  className,
  children,
}: {
  tone: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold leading-tight",
        TABLE_TAG_CLASSES[tone] ?? TABLE_TAG_CLASSES.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

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
  const modeTone = format?.badgeColor ?? "neutral";
  const limitedLabel = room.draft_config
    ? (room.draft_config.cube_name ?? room.draft_config.set_code)
    : room.sealed_config
      ? room.sealed_config.set_code
      : null;
  const showHost = !room.official && !room.hosted;
  const isForgeEngine = room.engine === "Forge";
  const isIronsmithEngine = room.engine === "Ironsmith";
  const engineTone = isForgeEngine ? "blue" : isIronsmithEngine ? "amber" : "sky";

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
      </div>
      {showHost && (
        <p className="-mt-1.5 truncate text-[11px] text-muted-foreground">
          Hosted by {stripUsernameTag(room.host)}
        </p>
      )}

      <OpenTableSeats players={room.players} maxPlayers={room.max_players} />

      <div className="flex flex-wrap items-center gap-1">
        {!isCompatible && <TableTag tone="rose">Incompatible</TableTag>}
        <TableTag tone={engineTone}>
          {isForgeEngine ? (
            <Anvil aria-hidden="true" className="h-3 w-3" />
          ) : isIronsmithEngine ? (
            <GameIcon aria-hidden="true" name="anvil" className="h-3 w-3" />
          ) : (
            <Cpu aria-hidden="true" className="h-3 w-3" />
          )}
          {room.engine}
        </TableTag>
        {room.format !== "Any" && <TableTag tone={modeTone}>{modeLabel}</TableTag>}
        {limitedLabel && (
          <TableTag tone="purple" className="max-w-[7rem] truncate uppercase">
            {limitedLabel}
          </TableTag>
        )}
      </div>

      <div className="mt-auto">
        {isMyRoom ? (
          <div className="flex h-8 items-center justify-center">
            <Badge variant="secondary" className="text-[10px]">
              Joined
            </Badge>
          </div>
        ) : canJoin ? (
          <Button
            size="sm"
            className="w-full gap-1.5"
            disabled={joining}
            aria-busy={joining}
            onClick={() => onJoin(room)}
          >
            <UserRoundPlus aria-hidden="true" className="h-3.5 w-3.5" />
            {joining ? "Joining..." : "Take a Seat"}
          </Button>
        ) : room.status === "InGame" ? (
          <div className="flex h-8 items-center justify-center text-xs text-muted-foreground">
            Playing
          </div>
        ) : isFull ? (
          <div className="flex h-8 items-center justify-center text-xs text-muted-foreground">
            Full
          </div>
        ) : null}
      </div>
    </article>
  );
}

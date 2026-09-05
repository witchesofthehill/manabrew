import { LockKeyhole, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EngineMark } from "@/components/lobby/EngineMark";
import { PlayerAvatar } from "@/components/lobby/PlayerAvatar";
import { getFormat } from "@/lib/formats";
import { stripUsernameTag } from "@/lib/username";
import { cn } from "@/lib/utils";
import type { RoomInfo } from "@/types/server";

interface RoomInviteCardProps {
  from: string;
  fromAvatarUrl?: string;
  room: RoomInfo;
  onJoin: () => void;
  onIgnore: () => void;
  className?: string;
}

function modeSentence(room: RoomInfo): string {
  if (room.draft_config) {
    const pool = room.draft_config.cube_name ?? room.draft_config.set_code;
    return pool ? `a ${pool} draft` : "a draft";
  }
  if (room.sealed_config) {
    const pool = room.sealed_config.cube_name ?? room.sealed_config.set_code;
    return pool ? `a ${pool} sealed game` : "a sealed game";
  }
  if (room.format === "Any") return "a game";
  const format = getFormat(room.format.toLowerCase());
  return `a ${format?.name ?? room.format} game`;
}

export function RoomInviteCard({
  from,
  fromAvatarUrl,
  room,
  onJoin,
  onIgnore,
  className,
}: RoomInviteCardProps) {
  const name = stripUsernameTag(from);
  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full flex-col gap-2.5 rounded-xl border bg-card p-3 text-foreground shadow-lg [--preview-shift-y:-6px] motion-safe:animate-preview-in",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <PlayerAvatar
          username={from}
          avatarUrl={fromAvatarUrl}
          className="h-8 w-8 shrink-0"
          fallbackClassName="text-xs"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight">
            <span className="font-semibold">{name}</span>{" "}
            <span className="text-muted-foreground">invited you to {modeSentence(room)}</span>
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate font-medium text-foreground/80">{room.room_name}</span>
            {room.password_protected && (
              <LockKeyhole
                aria-label="Password-protected table"
                className="h-3 w-3 shrink-0 text-format-badge-amber"
              />
            )}
            <span aria-hidden="true">·</span>
            <EngineMark engine={room.engine} className="h-3 w-3 shrink-0" />
            <span>{room.engine}</span>
            <span aria-hidden="true">·</span>
            <Users aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span>
              {room.players.length}/{room.max_players}
            </span>
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onIgnore}>
          Ignore
        </Button>
        <Button size="sm" onClick={onJoin}>
          Join table
        </Button>
      </div>
    </div>
  );
}

import { LockKeyhole, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EngineMark } from "@/components/lobby/EngineMark";
import { getFormat } from "@/lib/formats";
import { stripUsernameTag } from "@/lib/username";
import type { RoomInfo } from "@/types/server";

interface RoomInviteToastProps {
  from: string;
  fromAvatarUrl?: string;
  room: RoomInfo;
  onJoin: () => void;
  onIgnore: () => void;
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

export function RoomInviteToast({
  from,
  fromAvatarUrl,
  room,
  onJoin,
  onIgnore,
}: RoomInviteToastProps) {
  const name = stripUsernameTag(from);
  return (
    <div className="flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-primary/30 bg-card p-3 text-foreground shadow-lg">
      <div className="flex items-start gap-3">
        <Avatar className="h-9 w-9 shrink-0">
          {fromAvatarUrl && <AvatarImage src={fromAvatarUrl} alt="" crossOrigin="anonymous" />}
          <AvatarFallback className="text-sm">{name.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">
            <span className="font-semibold">{name}</span> invited you to {modeSentence(room)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate font-medium text-foreground/85">{room.room_name}</span>
            {room.password_protected && (
              <LockKeyhole
                aria-label="Password-protected table"
                className="h-3 w-3 shrink-0 text-format-badge-amber"
              />
            )}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <EngineMark engine={room.engine} className="h-3 w-3" />
              {room.engine}
            </span>
            <span className="flex items-center gap-1">
              <Users aria-hidden="true" className="h-3 w-3" />
              {room.players.length}/{room.max_players} seated
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

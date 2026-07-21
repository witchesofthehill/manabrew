import { BadgeCheck, Users } from "lucide-react";
import { EngineMark } from "@/components/lobby/EngineMark";
import { needsFormatChoice } from "@/components/lobby/tables.utils";
import { Button } from "@/components/ui/button";
import type { RoomInfo } from "@/types/server";

interface HostedTablesSectionProps {
  roomGroups: Array<[RoomInfo["engine"], RoomInfo[]]>;
  joiningRoomId: string | null;
  disabled?: boolean;
  onJoin: (rooms: RoomInfo[]) => void;
}

export function HostedTablesSection({
  roomGroups,
  joiningRoomId,
  disabled = false,
  onJoin,
}: HostedTablesSectionProps) {
  if (roomGroups.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Hosted Tables
      </h2>
      <div className="grid gap-2 lg:grid-cols-2">
        {roomGroups.map(([engine, engineRooms]) => {
          const targetRoom = engineRooms[0];
          const chooseFormat = needsFormatChoice(targetRoom);
          const isJoining = engineRooms.some((room) => joiningRoomId === room.room_id);
          return (
            <div key={engine} className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <EngineMark engine={engine} className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{engine}</span>
                    <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Official hosted capacity ready to play
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {engineRooms.length} {engineRooms.length === 1 ? "table" : "tables"} available
                </span>
                <Button
                  size="sm"
                  className="w-full min-[360px]:w-auto"
                  disabled={disabled || joiningRoomId !== null}
                  onClick={() => onJoin(engineRooms)}
                >
                  {isJoining ? "Joining…" : chooseFormat ? "Choose Format" : "Join"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

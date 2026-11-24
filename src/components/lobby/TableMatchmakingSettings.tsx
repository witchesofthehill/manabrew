import { useState } from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { tableStartsAutomatically } from "@/components/lobby/tables.utils";
import { getPlatform } from "@/platform";
import type { RoomInfo } from "@/types/server";

export function TableMatchmakingSettings({
  room,
  isController,
}: {
  room: RoomInfo;
  isController: boolean;
}) {
  const [pending, setPending] = useState(false);
  if (
    room.status !== "Lobby" ||
    room.draft_config ||
    room.sealed_config ||
    ["Draft", "Sealed"].includes(room.format)
  )
    return null;
  const recruiting =
    !room.password_protected &&
    ["Any", "Commander"].includes(room.format) &&
    room.table_bracket != null;
  const openSeats = room.max_players - room.players.length;

  async function setAutoStart(enabled: boolean) {
    setPending(true);
    try {
      await getPlatform().server?.setAutoStart(enabled);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change automatic start.");
    } finally {
      setPending(false);
    }
  }

  if (room.auto_start === undefined && !recruiting) return null;
  return (
    <div className="space-y-3 border-b border-border pb-3">
      {recruiting && (
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-ui-label font-medium">
              {openSeats > 0 ? "Finding players for your table" : "Your table is full"}
            </p>
            <p className="mt-1 text-ui-meta text-muted-foreground">
              {openSeats > 0
                ? `Inviting queued players at bracket ${room.table_bracket}. You can invite friends too.`
                : "Everyone needs to be ready before the game begins."}
            </p>
          </div>
        </div>
      )}
      {room.auto_start !== undefined &&
        (isController ? (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-ui-label">
            <Checkbox
              className="mt-1"
              checked={room.auto_start}
              disabled={pending}
              onCheckedChange={(checked) => void setAutoStart(checked === true)}
            />
            <span>
              Start automatically when everyone is ready
              <span className="mt-1 block text-ui-meta text-muted-foreground">
                Waits for all {room.max_players} seats to fill. Switch off to start the game
                yourself.
              </span>
            </span>
          </label>
        ) : (
          <p className="text-ui-meta text-muted-foreground">
            {tableStartsAutomatically(room)
              ? "The game starts automatically when the table is full and everyone is ready."
              : "The host will start the game when everyone is ready."}
          </p>
        ))}
    </div>
  );
}

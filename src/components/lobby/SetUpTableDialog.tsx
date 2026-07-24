import { BadgeCheck, Cloud, Plus, Users } from "lucide-react";
import { EngineMark } from "@/components/lobby/EngineMark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RoomInfo } from "@/types/server";

interface SetUpTableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostedRoomGroups: Array<[RoomInfo["engine"], RoomInfo[]]>;
  onJoinHosted: (rooms: RoomInfo[]) => void;
  onCreate: () => void;
}

export function SetUpTableDialog({
  open,
  onOpenChange,
  hostedRoomGroups,
  onJoinHosted,
  onCreate,
}: SetUpTableDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Set up a table</DialogTitle>
          <DialogDescription>
            Join an official hosted table or create one with your own settings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {hostedRoomGroups.length > 0 ? (
            hostedRoomGroups.map(([engine, rooms]) => (
              <article key={engine} className="flex flex-col rounded-xl border bg-card p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <EngineMark engine={engine} className="h-5 w-5" />
                </span>
                <div className="mt-3 flex items-center gap-1.5">
                  <h3 className="truncate text-sm font-semibold">Official table</h3>
                  <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Powered by the {engine} engine
                </p>
                <div className="mb-4 mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {rooms.length} {rooms.length === 1 ? "table" : "tables"} available
                </div>
                <Button
                  className="mt-auto w-full"
                  onClick={() => {
                    onOpenChange(false);
                    onJoinHosted(rooms);
                  }}
                >
                  <Cloud /> Create hosted table
                </Button>
              </article>
            ))
          ) : (
            <article className="flex flex-col rounded-xl border bg-card p-4 opacity-60">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Cloud className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-sm font-semibold">Hosted table</h3>
              <p className="mb-4 mt-1 text-xs leading-relaxed text-muted-foreground">
                No official hosted tables are available right now.
              </p>
              <Button className="mt-auto w-full" disabled>
                Unavailable
              </Button>
            </article>
          )}

          <article className="flex flex-col rounded-xl border bg-card p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Plus className="h-5 w-5" />
            </span>
            <h3 className="mt-3 text-sm font-semibold">Create your own table</h3>
            <p className="mb-4 mt-1 text-xs leading-relaxed text-muted-foreground">
              Choose the format, seats, privacy, engine, and limited settings yourself.
            </p>
            <Button
              variant="outline"
              className="mt-auto w-full"
              onClick={() => {
                onOpenChange(false);
                onCreate();
              }}
            >
              <Plus /> Create new table
            </Button>
          </article>
        </div>
      </DialogContent>
    </Dialog>
  );
}

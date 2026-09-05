import { useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PLAYER_ROW_ACTION_CLASS, PlayerRow } from "@/components/lobby/PlayerRow";
import { useServerStore } from "@/stores/useServerStore";
import { useInviteStore } from "@/stores/useInviteStore";
import { stripUsernameTag } from "@/lib/username";
import type { PlayerInfo } from "@/types/server";

interface InvitePlayersDialogProps {
  open: boolean;
  onClose: () => void;
}

function invitable(player: PlayerInfo, me: string | null): boolean {
  return player.connected && !player.room_id && !player.local_game && player.username !== me;
}

export function InvitePlayersDialog({ open, onClose }: InvitePlayersDialogProps) {
  const players = useServerStore((s) => s.players);
  const username = useServerStore((s) => s.username);
  const invited = useInviteStore((s) => s.sent);
  const invite = useInviteStore((s) => s.send);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const candidates = players
    .filter((p) => invitable(p, username))
    .filter((p) => !query || stripUsernameTag(p.username).toLowerCase().includes(query))
    .sort((a, b) =>
      stripUsernameTag(a.username)
        .toLowerCase()
        .localeCompare(stripUsernameTag(b.username).toLowerCase()),
    );

  function close() {
    setSearch("");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-sm">
        <DialogTitle className="flex items-center gap-2">
          <UserPlus className="h-4 w-4" />
          Invite players
        </DialogTitle>
        <DialogDescription>Players in the lobby who aren't at a table.</DialogDescription>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players…"
            className="h-8 pl-8 text-sm"
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-72">
          <div className="space-y-0.5 pr-2">
            {candidates.length === 0 && (
              <p className="py-6 text-center text-xs italic text-muted-foreground">
                {query ? `No players match “${search.trim()}”` : "Nobody is free right now"}
              </p>
            )}
            {candidates.map((player) => {
              const sent = invited.has(player.username);
              return (
                <PlayerRow
                  key={player.player_id}
                  player={player}
                  presenceDotClass="bg-success"
                  status={<span className="text-[10px] text-muted-foreground">Available</span>}
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      className={PLAYER_ROW_ACTION_CLASS}
                      disabled={sent}
                      onClick={() => void invite(player.username)}
                      title="Invite to your table"
                    >
                      <UserPlus className="h-3 w-3" />
                      {sent ? "Invited" : "Invite"}
                    </Button>
                  }
                />
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

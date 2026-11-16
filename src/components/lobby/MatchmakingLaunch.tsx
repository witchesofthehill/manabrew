import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tableLabel } from "@/stores/useMatchmakingStore";
import type { RoomInfo } from "@/types/server";

export function MatchmakingLaunch({
  room,
  username,
  onViewTable,
}: {
  room: RoomInfo;
  username: string | null;
  onViewTable: () => void;
}) {
  const player = room.players.find((seat) => seat.username === username);
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-4">
      <div className="my-auto flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 text-center shadow-md">
        <Loader2 className="h-7 w-7 animate-spin motion-reduce:animate-none text-primary" />
        <div className="space-y-2">
          <h1 className="font-serif text-3xl font-semibold">Taking you to the game</h1>
          <p className="text-ui-body text-muted-foreground">
            {tableLabel(room.max_players)} · Bracket {room.matchmade_bracket}
          </p>
          {player?.selected_deck_name && (
            <p className="text-ui-label">{player.selected_deck_name}</p>
          )}
          <p className="text-ui-meta text-muted-foreground">
            {room.players.length < room.max_players
              ? "Filling the remaining seats with Manabot…"
              : "Your deck is ready. The game starts automatically."}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onViewTable}>
          View table
        </Button>
      </div>
    </div>
  );
}

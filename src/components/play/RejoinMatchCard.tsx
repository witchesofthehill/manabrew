import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Swords, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearActiveGameSession, peekActiveGameSession } from "@/lib/activeGameSession";
import { ROUTES } from "@/lib/constants";
import { useServerStore } from "@/stores/useServerStore";

export function RejoinMatchCard() {
  const navigate = useNavigate();
  const connected = useServerStore((state) => state.connected);
  const currentRoom = useServerStore((state) => state.currentRoom);
  const [dismissed, setDismissed] = useState(false);

  const marker = peekActiveGameSession();
  if (dismissed || !marker) return null;
  if (connected && currentRoom && currentRoom.room_id !== marker.roomId) return null;

  function dismiss() {
    clearActiveGameSession();
    if (currentRoom?.room_id === marker?.roomId) {
      void useServerStore.getState().leaveRoom();
    }
    setDismissed(true);
  }

  return (
    <section className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4 shadow-xl backdrop-blur-md sm:gap-4 sm:p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
        <Swords className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Match in progress</p>
        <p className="truncate text-sm text-muted-foreground">
          {currentRoom?.room_id === marker.roomId
            ? `You're still seated at ${currentRoom.room_name}.`
            : "You're still seated in an online match."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" className="gap-1" onClick={dismiss}>
          <X className="h-3.5 w-3.5" />
          Dismiss
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => navigate(ROUTES.LOBBY)}>
          <Swords className="h-3.5 w-3.5" />
          Rejoin
        </Button>
      </div>
    </section>
  );
}

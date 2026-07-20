import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Swords, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  armActiveGameSession,
  clearActiveGameSession,
  type ActiveGameSession,
} from "@/lib/activeGameSession";
import { ROUTES } from "@/lib/constants";
import { useServerStore } from "@/stores/useServerStore";

interface RejoinMatchCardProps {
  session: ActiveGameSession;
  onDismiss: () => void;
}

export function RejoinMatchCard({ session, onDismiss }: RejoinMatchCardProps) {
  const navigate = useNavigate();
  const currentRoom = useServerStore((state) => state.currentRoom);
  const [dismissing, setDismissing] = useState(false);

  async function dismiss() {
    if (dismissing) return;
    setDismissing(true);
    clearActiveGameSession();
    try {
      const server = useServerStore.getState();
      if (currentRoom?.room_id === session.roomId) {
        await server.leaveRoom();
      } else if (!currentRoom && server.connected) {
        await server.leaveRoom();
      } else if (!currentRoom && server.connecting) {
        await server.disconnect();
      }
      onDismiss();
    } catch {
      armActiveGameSession(session);
      setDismissing(false);
      toast.error("Couldn't abandon the previous match. Try again.");
    }
  }

  return (
    <section className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4 shadow-xl backdrop-blur-md sm:gap-4 sm:p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
        <Swords className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Match in progress</p>
        <p className="truncate text-sm text-muted-foreground">
          {currentRoom?.room_id === session.roomId
            ? `You're still seated at ${currentRoom.room_name}.`
            : "You're still seated in an online match."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="gap-1"
          disabled={dismissing}
          onClick={() => void dismiss()}
        >
          {dismissing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
          {dismissing ? "Abandoning…" : "Dismiss"}
        </Button>
        <Button
          size="sm"
          className="gap-1.5"
          disabled={dismissing}
          onClick={() => navigate(ROUTES.LOBBY)}
        >
          <Swords className="h-3.5 w-3.5" />
          Rejoin
        </Button>
      </div>
    </section>
  );
}

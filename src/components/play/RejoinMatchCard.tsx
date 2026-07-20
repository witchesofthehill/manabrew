import { useNavigate } from "react-router-dom";
import { Swords, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearActiveGameSession, type ActiveGameSession } from "@/lib/activeGameSession";
import { ROUTES } from "@/lib/constants";
import { useServerStore } from "@/stores/useServerStore";

interface RejoinMatchCardProps {
  session: ActiveGameSession;
  onDismiss: () => void;
}

export function RejoinMatchCard({ session, onDismiss }: RejoinMatchCardProps) {
  const navigate = useNavigate();
  const currentRoom = useServerStore((state) => state.currentRoom);

  function dismiss() {
    clearActiveGameSession();
    if (currentRoom?.room_id === session.roomId) {
      void useServerStore.getState().leaveRoom();
    }
    onDismiss();
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

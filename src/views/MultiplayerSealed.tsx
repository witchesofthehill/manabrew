import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { useTopBarOverride } from "@/components/layout/TopBarOverride";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { useMultiplayerSealedStore } from "@/stores/useMultiplayerSealedStore";
import { useServerStore } from "@/stores/useServerStore";

export default function MultiplayerSealed() {
  const navigate = useNavigate();
  const mode = useMultiplayerSealedStore((s) => s.mode);
  const pool = useMultiplayerSealedStore((s) => s.pool);
  const setCode = useMultiplayerSealedStore((s) => s.setCode);
  const lastError = useMultiplayerSealedStore((s) => s.lastError);
  const cleanupStarted = useRef(false);
  const leavingHome = useRef(false);

  function cleanup() {
    if (cleanupStarted.current) return;
    cleanupStarted.current = true;
    const sealed = useMultiplayerSealedStore.getState();
    const server = useServerStore.getState();
    if (
      sealed.mode !== "idle" &&
      sealed.roomId === server.currentRoom?.room_id &&
      server.currentRoom.host === server.username
    ) {
      void server.endGame().catch(() => {});
    }
    sealed.clear();
  }

  const exitTo = (destination: string) => {
    cleanup();
    navigate(destination);
  };

  const exitHome = async () => {
    leavingHome.current = true;
    cleanup();
    await useServerStore.getState().leaveRoom();
    navigate(ROUTES.PLAY);
  };

  useTopBarOverride({
    onBack: () => exitTo(ROUTES.LOBBY),
    onHome: () => void exitHome(),
    navigationDisabled: true,
  });

  useEffect(() => {
    if (mode === "idle" && !leavingHome.current) navigate(ROUTES.LOBBY, { replace: true });
  }, [mode, navigate]);

  useEffect(() => {
    return cleanup;
  }, []);

  if (mode === "idle") return null;

  if (mode === "building" && pool.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Generating your sealed pool…
        {lastError && <p className="mt-2 text-destructive">{lastError}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-3xl">
          <p className="font-semibold text-foreground">{setCode.toUpperCase()} sealed pool</p>
          <p className="text-sm text-muted-foreground">
            Build a 40-card deck from your pool. Use "Save to My Decks" when you're happy — your
            saved deck is then selectable in any Match room.
          </p>
        </div>
        <Button variant="outline" onClick={() => exitTo(ROUTES.LOBBY)}>
          Exit
        </Button>
      </header>

      <div className="min-h-0 flex-1">
        <LimitedDeckBuilder
          pool={pool}
          defaultDeckName={`Sealed ${setCode.toUpperCase()}`}
          format="sealed"
          onSaved={() => exitTo(ROUTES.LOBBY)}
        />
      </div>
    </div>
  );
}

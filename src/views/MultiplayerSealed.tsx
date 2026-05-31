import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { Button } from "@/components/ui/button";
import { useMultiplayerSealedStore } from "@/stores/useMultiplayerSealedStore";
import { useServerStore } from "@/stores/useServerStore";

export default function MultiplayerSealed() {
  const navigate = useNavigate();
  const mode = useMultiplayerSealedStore((s) => s.mode);
  const pool = useMultiplayerSealedStore((s) => s.pool);
  const setCode = useMultiplayerSealedStore((s) => s.setCode);
  const lastError = useMultiplayerSealedStore((s) => s.lastError);
  const clear = useMultiplayerSealedStore((s) => s.clear);
  const endGame = useServerStore((s) => s.endGame);
  const currentRoom = useServerStore((s) => s.currentRoom);
  const username = useServerStore((s) => s.username);
  const amHost = !!currentRoom && currentRoom.host === username;

  const exit = () => {
    if (amHost) void endGame().catch(() => {});
    clear();
    navigate("/lobby");
  };

  useEffect(() => {
    if (mode === "idle") navigate("/lobby");
  }, [mode, navigate]);

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
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sealed deck build · {setCode.toUpperCase()}</h1>
          <p className="text-sm text-muted-foreground">
            Build a 40-card deck from your pool. Use "Save to My Decks" when you're happy — your
            saved deck is then selectable in any Match room.
          </p>
        </div>
        <Button variant="outline" onClick={exit}>
          Exit
        </Button>
      </header>

      <div className="min-h-0 flex-1">
        <LimitedDeckBuilder
          pool={pool}
          defaultDeckName={`Sealed ${setCode.toUpperCase()}`}
          format="sealed"
          onSaved={exit}
        />
      </div>
    </div>
  );
}

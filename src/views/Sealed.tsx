import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { LimitedPackOpening } from "@/components/limited/LimitedPackOpening";
import { LimitedPlayAction } from "@/components/limited/LimitedPlayAction";
import { LimitedTableSurface } from "@/components/limited/LimitedTableSurface";
import { useLimitedStore } from "@/stores/useLimitedStore";
import type { DraftCard } from "@/types/limited";
export default function Sealed() {
  const { id } = useParams<{
    id: string;
  }>();
  const activeSealed = useLimitedStore((s) => s.activeSealed);
  const refresh = useLimitedStore((s) => s.refreshSealedPool);
  const lastError = useLimitedStore((s) => s.lastError);
  const [builtDeck, setBuiltDeck] = useState<{
    sessionId: string | null;
    main: DraftCard[];
    sideboard: DraftCard[];
  }>({
    sessionId: null,
    main: [],
    sideboard: [],
  });
  const [openedSession, setOpenedSession] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    if (!activeSealed || activeSealed.sessionId !== id) {
      refresh(id);
    }
  }, [id, activeSealed, refresh]);

  if (!activeSealed || activeSealed.sessionId !== id) {
    return (
      <LimitedTableSurface className="items-center justify-center">
        {lastError ? (
          <p className="text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground">Loading sealed pool…</p>
        )}
      </LimitedTableSurface>
    );
  }
  return (
    <LimitedTableSurface className="gap-2 px-4 py-3 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            {activeSealed.packs.length} packs · {activeSealed.cards.length} cards ·{" "}
            {activeSealed.aiDecks.length} AI opponents ready for the gauntlet
          </p>
        </div>
        {openedSession === activeSealed.sessionId && (
          <LimitedPlayAction
            sessionId={activeSealed.sessionId}
            kind="sealed"
            rounds={activeSealed.aiDecks.length}
            deck={
              builtDeck.sessionId === activeSealed.sessionId
                ? builtDeck
                : { main: [], sideboard: [] }
            }
          />
        )}
      </header>

      <div className="min-h-0 flex-1">
        {openedSession !== activeSealed.sessionId ? (
          <LimitedPackOpening
            key={activeSealed.sessionId}
            sessionKey={activeSealed.sessionId}
            packs={activeSealed.packs}
            onComplete={() => setOpenedSession(activeSealed.sessionId)}
          />
        ) : (
          <LimitedDeckBuilder
            key={activeSealed.sessionId}
            sessionKey={activeSealed.sessionId}
            pool={activeSealed.cards}
            suggestedMain={activeSealed.suggestedDeck?.main}
            defaultDeckName={activeSealed.deckName}
            format="sealed"
            onChange={(deck) => setBuiltDeck({ sessionId: activeSealed.sessionId, ...deck })}
          />
        )}
      </div>

      {lastError && (
        <p className="rounded border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {lastError}
        </p>
      )}
    </LimitedTableSurface>
  );
}

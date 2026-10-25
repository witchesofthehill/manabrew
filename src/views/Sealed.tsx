import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { LimitedPackOpening } from "@/components/limited/LimitedPackOpening";
import { LimitedPlayAction } from "@/components/limited/LimitedPlayAction";
import { LimitedTableSurface } from "@/components/limited/LimitedTableSurface";
import { LimitedSettingsButton } from "@/components/limited/LimitedSettingsButton";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { useLimitedSessionSource } from "@/components/limited/useLimitedSavedSession";
import type { DraftCard } from "@/types/limited";
export default function Sealed() {
  const { id } = useParams<{
    id: string;
  }>();
  const referenceFormat = useLimitedSessionSource(id ?? null);
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
      <LimitedTableSurface className="items-center justify-center overflow-y-auto overscroll-contain px-4 py-3 text-ui-body break-words sm:px-6 lg:px-8">
        {lastError ? (
          <p className="max-h-full shrink-0 overflow-y-auto text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground">Loading sealed pool…</p>
        )}
      </LimitedTableSurface>
    );
  }
  return (
    <LimitedTableSurface className="min-w-0 gap-2 px-4 py-3 text-ui-body sm:px-6 lg:px-8">
      <header className="-mx-1 flex max-h-[40%] shrink-0 flex-wrap items-center justify-between gap-2 overflow-y-auto overscroll-contain px-1 py-1">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-ui-meta break-words text-muted-foreground">
            {activeSealed.packs.length} packs · {activeSealed.cards.length} cards ·{" "}
            {openedSession === activeSealed.sessionId
              ? `${activeSealed.aiDecks.length} AI opponents ready for the gauntlet`
              : "Open your packs to reveal your pool"}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
          <LimitedSettingsButton sessionKey={activeSealed.sessionId} />
        </div>
      </header>

      <div className="min-h-0 min-w-0 flex-1">
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
            referenceFormat={referenceFormat}
            onChange={(deck) => setBuiltDeck({ sessionId: activeSealed.sessionId, ...deck })}
          />
        )}
      </div>

      {lastError && (
        <p className="max-h-[20%] shrink-0 overflow-y-auto overscroll-contain rounded border border-destructive/70 bg-destructive/10 p-3 text-ui-label break-words text-destructive">
          {lastError}
        </p>
      )}
    </LimitedTableSurface>
  );
}

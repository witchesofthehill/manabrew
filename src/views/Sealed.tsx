import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { useLimitedStore } from "@/stores/useLimitedStore";
import type { DraftCard } from "@/types/limited";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export default function Sealed() {
  const { id } = useParams<{
    id: string;
  }>();
  const navigate = useNavigate();
  const activeSealed = useLimitedStore((s) => s.activeSealed);
  const refresh = useLimitedStore((s) => s.refreshSealedPool);
  const startGauntlet = useLimitedStore((s) => s.startGauntletFromSealed);
  const isStarting = useLimitedStore((s) => s.isStarting);
  const lastError = useLimitedStore((s) => s.lastError);
  const [builtDeck, setBuiltDeck] = useState<{
    main: DraftCard[];
    sideboard: DraftCard[];
  }>({
    main: [],
    sideboard: [],
  });
  const TARGET_MAIN_SIZE = 40;
  const mainShortBy = Math.max(0, TARGET_MAIN_SIZE - builtDeck.main.length);
  useEffect(() => {
    if (!id) return;
    if (!activeSealed || activeSealed.sessionId !== id) {
      refresh(id);
    }
  }, [id, activeSealed, refresh]);
  const initialMain = useMemo(
    () => activeSealed?.suggestedDeck?.main ?? [],
    [activeSealed?.suggestedDeck],
  );
  const initialSideboard = useMemo(
    () => activeSealed?.suggestedDeck?.sideboard ?? [],
    [activeSealed?.suggestedDeck],
  );
  if (!activeSealed) {
    return (
      <div className="flex h-full items-center justify-center">
        {lastError ? (
          <p className="text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground">
            <Trans>Loading sealed pool…</Trans>
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">{activeSealed.deckName}</p>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              <Trans>
                {activeSealed.cards.length} cards opened · {activeSealed.aiDecks.length} AI decks
                ready
              </Trans>
            </span>
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              <Trans>Pool ready</Trans>
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            disabled={isStarting || !id || activeSealed.aiDecks.length === 0 || mainShortBy > 0}
            title={
              mainShortBy > 0
                ? mainShortBy === 1
                  ? i18n._(msg`Main deck needs one more card to start`)
                  : i18n._(msg`Main deck needs ${mainShortBy} more cards to start`)
                : undefined
            }
            onClick={async () => {
              if (!id) return;
              try {
                const g = await startGauntlet(
                  id,
                  activeSealed.aiDecks.length,
                  builtDeck.main,
                  builtDeck.sideboard,
                );
                navigate(`/gauntlet/${g.gauntletId}`);
              } catch {
                /* surfaced via lastError */
              }
            }}
          >
            {isStarting
              ? i18n._(msg`Setting up\u2026`)
              : mainShortBy > 0
                ? i18n._(msg`Need ${mainShortBy} more card${mainShortBy === 1 ? "" : "s"}`)
                : i18n._(msg`Start Gauntlet`)}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <LimitedDeckBuilder
          pool={activeSealed.cards}
          initialMain={initialMain}
          initialSideboard={initialSideboard}
          defaultDeckName={activeSealed.deckName}
          format="sealed"
          onChange={setBuiltDeck}
        />
      </div>

      {lastError && (
        <p className="rounded border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {lastError}
        </p>
      )}
    </div>
  );
}

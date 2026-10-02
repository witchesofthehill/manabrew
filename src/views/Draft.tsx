import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { DraftStatusBar } from "@/components/limited/DraftStatusBar";
import { DraftWorkspace } from "@/components/limited/DraftWorkspace";
import { LimitedTableSurface } from "@/components/limited/LimitedTableSurface";
import type { LimitedDraftMode } from "@/components/limited/LimitedModeToggle";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import { LimitedPlayAction } from "@/components/limited/LimitedPlayAction";
import type { DraftCard } from "@/types/limited";
type DraftMode = LimitedDraftMode;
export default function Draft() {
  const { draftId } = useParams<{
    draftId: string;
  }>();
  const activeDraft = useLimitedStore((s) => s.activeDraft);
  const pick = useLimitedStore((s) => s.pickDraftCard);
  const undo = useLimitedStore((s) => s.undoDraftPick);
  const refresh = useLimitedStore((s) => s.refreshDraftState);
  const conspiracyHooks = useLimitedStore((s) => s.conspiracyHooks);
  const fetchConspiracyHooks = useLimitedStore((s) => s.fetchConspiracyHooks);
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
  const [userMode, setUserMode] = useState<DraftMode>("drafting");
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  useEffect(() => {
    if (!draftId) return;
    if (!activeDraft || activeDraft.sessionId !== draftId) {
      refresh(draftId);
    }
  }, [draftId, activeDraft, refresh]);
  useEffect(() => {
    if (conspiracyHooks.length === 0) {
      fetchConspiracyHooks();
    }
  }, [conspiracyHooks.length, fetchConspiracyHooks]);
  const mode: DraftMode = activeDraft?.isComplete ? "building" : userMode;
  if (!activeDraft || activeDraft.sessionId !== draftId) {
    return (
      <LimitedTableSurface className="items-center justify-center">
        {lastError ? (
          <p className="text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground">Loading draft…</p>
        )}
      </LimitedTableSurface>
    );
  }
  const handlePick = async (card: DraftCard) => {
    if (!draftId || !activeDraft.awaitingHuman || pickingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    try {
      await pick(draftId, card);
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  };
  const handleUndo = async () => {
    if (!draftId) return;
    try {
      const state = await undo(draftId);
      useLimitedBuildStore.getState().reconcilePool(draftId, state.pickedPile);
    } catch {
      /* surfaced via lastError */
    }
  };
  const canBuild = activeDraft.pickedPile.length >= 1;
  return (
    <LimitedTableSurface className="gap-2 px-4 py-3 sm:px-6 lg:px-8">
      <DraftStatusBar
        draft={activeDraft}
        mode={mode}
        onModeChange={setUserMode}
        onUndo={!activeDraft.isComplete ? handleUndo : undefined}
        canBuild={canBuild}
      />

      {activeDraft.isComplete && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Your pool is complete. Build your deck, then play against the decks drafted at this
            table.
          </p>
          <LimitedPlayAction
            sessionId={activeDraft.sessionId}
            kind="draft"
            rounds={Math.max(0, activeDraft.seatSummaries.length - 1)}
            deck={
              builtDeck.sessionId === activeDraft.sessionId
                ? builtDeck
                : { main: [], sideboard: [] }
            }
          />
        </div>
      )}

      {mode === "building" ? (
        <div className="min-h-0 flex-1">
          <LimitedDeckBuilder
            key={activeDraft.sessionId}
            sessionKey={activeDraft.sessionId}
            pool={activeDraft.pickedPile}
            defaultDeckName="Booster Draft Deck"
            format="draft"
            onChange={(deck) => setBuiltDeck({ sessionId: activeDraft.sessionId, ...deck })}
          />
        </div>
      ) : (
        <DraftWorkspace
          draft={activeDraft}
          onPick={handlePick}
          conspiracyHooks={conspiracyHooks}
          pickPending={picking}
        />
      )}

      {lastError && (
        <p className="rounded border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {lastError}
        </p>
      )}
    </LimitedTableSurface>
  );
}

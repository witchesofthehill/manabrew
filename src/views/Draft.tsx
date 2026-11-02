import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { DraftStatusBar } from "@/components/limited/DraftStatusBar";
import { DraftWorkspace } from "@/components/limited/DraftWorkspace";
import { LimitedTableSurface } from "@/components/limited/LimitedTableSurface";
import { LimitedSettingsButton } from "@/components/limited/LimitedSettingsButton";
import type { LimitedDraftMode } from "@/components/limited/LimitedModeToggle";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { useLimitedSessionSource } from "@/components/limited/useLimitedSavedSession";
import { LimitedPlayAction } from "@/components/limited/LimitedPlayAction";
import type { DraftCard } from "@/types/limited";
type DraftMode = LimitedDraftMode;
export default function Draft() {
  const { draftId } = useParams<{
    draftId: string;
  }>();
  const referenceFormat = useLimitedSessionSource(draftId ?? null);
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
      <LimitedTableSurface className="items-center justify-center overflow-y-auto overscroll-contain px-4 py-3 text-ui-body break-words sm:px-6 lg:px-8">
        {lastError ? (
          <p className="max-h-full shrink-0 overflow-y-auto text-destructive">{lastError}</p>
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
      await pick(draftId, card, activeDraft.revision);
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  };
  const handleUndo = async () => {
    if (!draftId) return;
    try {
      await undo(draftId);
    } catch {
      /* surfaced via lastError */
    }
  };
  const canBuild = activeDraft.pickedPile.length >= 1;
  return (
    <LimitedTableSurface className="min-w-0 gap-2 px-4 py-3 text-ui-body sm:px-6 lg:px-8">
      <div className="-mx-1 max-h-[40%] shrink-0 space-y-2 overflow-y-auto overscroll-contain px-1 py-1">
        <DraftStatusBar
          draft={activeDraft}
          mode={mode}
          onModeChange={setUserMode}
          onUndo={!activeDraft.isComplete ? handleUndo : undefined}
          canBuild={canBuild}
          settings={<LimitedSettingsButton sessionKey={activeDraft.sessionId} quickPick />}
        />

        {activeDraft.isComplete && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 basis-64 text-ui-body break-words text-muted-foreground">
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
      </div>

      {mode === "building" ? (
        <div className="min-h-0 min-w-0 flex-1">
          <LimitedDeckBuilder
            key={activeDraft.sessionId}
            sessionKey={activeDraft.sessionId}
            pool={activeDraft.pickedPile}
            defaultDeckName="Booster Draft Deck"
            format="draft"
            referenceFormat={referenceFormat}
            onChange={(deck) => setBuiltDeck({ sessionId: activeDraft.sessionId, ...deck })}
          />
        </div>
      ) : (
        <DraftWorkspace
          draft={activeDraft}
          onPick={handlePick}
          conspiracyHooks={conspiracyHooks}
          pickPending={picking}
          referenceFormat={referenceFormat}
        />
      )}

      {lastError && (
        <p className="max-h-[20%] shrink-0 overflow-y-auto overscroll-contain rounded border border-destructive/70 bg-destructive/10 p-3 text-ui-label break-words text-destructive">
          {lastError}
        </p>
      )}
    </LimitedTableSurface>
  );
}

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { DraftStatusBar } from "@/components/limited/DraftStatusBar";
import { DraftWorkspace } from "@/components/limited/DraftWorkspace";
import type { LimitedDraftMode } from "@/components/limited/LimitedModeToggle";
import { useLimitedStore } from "@/stores/useLimitedStore";
import type { DraftCard } from "@/types/limited";

type DraftMode = LimitedDraftMode;

export default function Draft() {
  const { draftId } = useParams<{ draftId: string }>();
  const activeDraft = useLimitedStore((s) => s.activeDraft);
  const pick = useLimitedStore((s) => s.pickDraftCard);
  const undo = useLimitedStore((s) => s.undoDraftPick);
  const refresh = useLimitedStore((s) => s.refreshDraftState);
  const conspiracyHooks = useLimitedStore((s) => s.conspiracyHooks);
  const fetchConspiracyHooks = useLimitedStore((s) => s.fetchConspiracyHooks);
  const lastError = useLimitedStore((s) => s.lastError);

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

  // Derive the effective mode — the draft being complete forces the
  // builder, otherwise the user's selection wins. Computed in render
  // so we avoid the setState-in-effect anti-pattern.
  const mode: DraftMode = activeDraft?.isComplete ? "building" : userMode;

  if (!activeDraft) {
    return (
      <div className="flex h-full items-center justify-center">
        {lastError ? (
          <p className="text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground">Loading draft…</p>
        )}
      </div>
    );
  }

  const handlePick = async (card: DraftCard) => {
    if (!draftId || !activeDraft.awaitingHuman || pickingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    try {
      await pick(draftId, card);
    } catch {
      /* surfaced via lastError */
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
    <div className="flex h-full flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <DraftStatusBar
        draft={activeDraft}
        mode={mode}
        onModeChange={setUserMode}
        onUndo={!activeDraft.isComplete ? handleUndo : undefined}
        canBuild={canBuild}
      />

      {mode === "building" ? (
        <div className="min-h-0 flex-1">
          <LimitedDeckBuilder
            pool={activeDraft.pickedPile}
            defaultDeckName="Booster Draft Deck"
            format="draft"
          />
        </div>
      ) : (
        <DraftWorkspace
          draft={activeDraft}
          onPick={handlePick}
          onBuild={canBuild ? () => setUserMode("building") : undefined}
          conspiracyHooks={conspiracyHooks}
          pickPending={picking}
        />
      )}

      {lastError && (
        <p className="rounded border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {lastError}
        </p>
      )}
    </div>
  );
}

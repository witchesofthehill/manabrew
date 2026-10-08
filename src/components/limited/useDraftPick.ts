import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLimitedBuildStore, type BuildZone } from "@/components/limited/useLimitedBuildStore";
import { useDraftClock } from "@/components/limited/useDraftClock";
import { draftDecisionRevision, nominateDraftFallback } from "@/game/limitedDraftClock";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import type { DraftCard, DraftState } from "@/types/limited";

export interface DraftPickOptions {
  draft: DraftState;
  onPick: (card: DraftCard) => void | Promise<void>;
  pickPending?: boolean;
  viewerSeat?: number;
}

export function useDraftPick({ draft, onPick, pickPending = false, viewerSeat }: DraftPickOptions) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const builderRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const pickZone = useRef<BuildZone>("pool");
  const wasPickPending = useRef(false);
  const quickPick = useLimitedBuildStore((state) => state.quickPick);
  const selected = draft.currentPack.find((card) => card.id === selectedId);
  const multiplayerSeat = useMultiplayerDraftStore((state) =>
    state.sessionId === draft.sessionId ? state.mySeat : null,
  );
  const seat = viewerSeat ?? multiplayerSeat ?? 0;
  const clock = useDraftClock(draft.sessionId, seat);
  const nominated = draft.currentPack.find((card) => card.id === clock.nominatedId);
  const nominate = async (card: DraftCard | null) => {
    if (
      !draft.awaitingHuman ||
      pickPending ||
      !clock.seat ||
      (card && !draft.currentPack.some((candidate) => candidate.id === card.id))
    )
      return;
    try {
      await nominateDraftFallback(
        draft.sessionId,
        seat,
        draftDecisionRevision(draft),
        card?.id ?? null,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The fallback could not be changed.");
    }
  };
  const disabled = !draft.awaitingHuman || pickPending || submitting;
  const pickTarget = useCallback(
    () =>
      builderRef.current?.querySelector<HTMLElement>(
        `section[data-limited-zone="${pickZone.current}"]`,
      ) ?? null,
    [],
  );
  useEffect(() => {
    if (wasPickPending.current && !pickPending) {
      const store = useLimitedBuildStore.getState();
      const pending = store.pendingPicks[draft.sessionId];
      if (pending && !draft.pickedPile.some((card) => card.id === pending.id))
        store.cancelPick(draft.sessionId, pending.id);
    }
    wasPickPending.current = pickPending;
  }, [pickPending, draft.sessionId, draft.pickedPile]);
  const submit = async (card: DraftCard, zone: BuildZone = "pool") => {
    if (
      disabled ||
      submittingRef.current ||
      !draft.currentPack.some((candidate) => candidate.id === card.id)
    )
      return;
    setSelectedId(card.id);
    pickZone.current = zone;
    useLimitedBuildStore.getState().queuePick(draft.sessionId, card.id, zone);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onPick(card);
      setSelectedId(null);
    } catch (error) {
      useLimitedBuildStore.getState().cancelPick(draft.sessionId, card.id);
      toast.error(error instanceof Error ? error.message : "The pick wasn't accepted. Try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  const select = (card: DraftCard) => {
    if (disabled) return;
    setSelectedId(card.id);
    if (quickPick) void submit(card);
  };
  const dropPick = (card: DraftCard, x: number, y: number) => {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-limited-zone]");
    if (!target || !workspaceRef.current?.contains(target)) return;
    const zone = target.dataset.limitedZone;
    if (zone === "main" || zone === "pool" || zone === "sideboard" || zone === "maybe")
      void submit(card, zone);
  };
  return {
    selected,
    nominated,
    nominate,
    clock,
    submitting,
    disabled,
    workspaceRef,
    builderRef,
    pickTarget,
    submit,
    select,
    dropPick,
  };
}

import { useEffect, useRef, useState } from "react";
import { useGameStore } from "@/stores/useGameStore";
import type { FlashItem } from "@/components/game/game.types";

/**
 * Manages the display-event flash queue: processes deferred snapshots,
 * shows card-play / turn-change flashes sequentially, then applies
 * the deferred gameView + prompt to the store.
 */
export function useFlashQueue(flashDurationMs: number) {
  const deferredQueue = useGameStore((s) => s.deferredQueue);
  const [activeFlash, setActiveFlash] = useState<FlashItem | null>(null);
  const flashQueueRef = useRef<FlashItem[]>([]);
  const isFlashingRef = useRef(false);
  const deferredStateRef = useRef<{ gameView: unknown; prompt: unknown } | null>(null);

  function applyDeferredState() {
    const deferred = deferredStateRef.current;
    if (!deferred) return;
    deferredStateRef.current = null;
    applySnapshotFields(deferred.gameView, deferred.prompt);
  }

  function applySnapshotFields(gameView: unknown, prompt: unknown) {
    const updates: Record<string, unknown> = {};
    if (gameView) updates.gameView = gameView;
    if (prompt) {
      updates.currentPrompt = prompt;
      updates.isWaitingForResponse = false;
    }
    if (Object.keys(updates).length > 0) useGameStore.setState(updates);
  }

  function startNextSnapshot() {
    const queue = useGameStore.getState().deferredQueue;
    if (queue.length === 0) {
      isFlashingRef.current = false;
      useGameStore.setState({ isFlashing: false });
      return;
    }

    const [snapshot, ...rest] = queue;
    useGameStore.setState({ deferredQueue: rest });

    if (snapshot.displayEvents.length === 0) {
      applySnapshotFields(snapshot.gameView, snapshot.prompt);
      if (rest.length > 0) {
        setTimeout(startNextSnapshot, 0);
      } else {
        isFlashingRef.current = false;
        useGameStore.setState({ isFlashing: false });
      }
      return;
    }

    deferredStateRef.current = { gameView: snapshot.gameView, prompt: snapshot.prompt };

    for (const evt of snapshot.displayEvents) {
      if (evt.kind === "cardPlayed") {
        flashQueueRef.current.push({
          kind: "card",
          cardId: evt.cardId!,
          cardName: evt.cardName!,
          setCode: evt.setCode ?? "",
        });
      } else if (evt.kind === "turnChanged") {
        flashQueueRef.current.push({
          kind: "turn",
          playerId: evt.activePlayerId!,
          playerName: evt.activePlayerName!,
        });
      }
    }

    const first = flashQueueRef.current.shift();
    if (first) {
      isFlashingRef.current = true;
      useGameStore.setState({ isFlashing: true });
      setActiveFlash(first);
    }
  }

  // The store's `isFlashing` flag and the deferred queue are drained ONLY by
  // this hook. If it unmounts mid-flash (leaving the game), the store would be
  // left `isFlashing: true` / queue non-empty with no drainer, wedging the
  // next game's first state on the loading screen. Tie that store state to
  // this hook's lifetime: clear it on unmount so it can never outlive its
  // drainer.
  useEffect(() => {
    return () => {
      isFlashingRef.current = false;
      flashQueueRef.current = [];
      deferredStateRef.current = null;
      useGameStore.setState({ isFlashing: false, deferredQueue: [] });
    };
  }, []);

  // Watch the deferred queue — when entries arrive and we're idle, start processing.
  useEffect(() => {
    if (deferredQueue.length > 0 && !isFlashingRef.current) {
      startNextSnapshot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQueue]);

  // Process flash queue: when current flash ends, show next or apply deferred state.
  useEffect(() => {
    if (!activeFlash) {
      const next = flashQueueRef.current.shift();
      if (next) {
        isFlashingRef.current = true;
        setActiveFlash(next);
      } else {
        applyDeferredState();
        const queue = useGameStore.getState().deferredQueue;
        if (queue.length > 0) {
          setTimeout(startNextSnapshot, 10);
        } else {
          isFlashingRef.current = false;
          useGameStore.setState({ isFlashing: false });
        }
      }
      return;
    }
    const timer = setTimeout(() => {
      setActiveFlash(null);
    }, flashDurationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFlash, flashDurationMs]);

  return activeFlash;
}

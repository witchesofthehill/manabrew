import { useEffect, useRef, useState } from "react";
import { useGameStore, type DeferredSnapshot } from "@/stores/useGameStore";
import { applySnapshot } from "@/stores/gameStore.constants";
import type { FlashItem } from "@/components/game/game.types";
import { flashItemOf } from "@/lib/gameViewTransitions";
import { playSound } from "@/lib/soundRuntime";

function applyQueuedSnapshot(snapshot: DeferredSnapshot) {
  applySnapshot(snapshot, useGameStore.setState, useGameStore.getState);
}

export function useFlashQueue(flashDurationMs: number) {
  const deferredQueue = useGameStore((s) => s.deferredQueue);
  const [activeFlash, setActiveFlash] = useState<FlashItem | null>(null);
  const flashQueueRef = useRef<FlashItem[]>([]);
  const isFlashingRef = useRef(false);
  const deferredSnapshotRef = useRef<DeferredSnapshot | null>(null);

  function applyDeferredSnapshot() {
    const deferred = deferredSnapshotRef.current;
    if (!deferred) return;
    deferredSnapshotRef.current = null;
    applyQueuedSnapshot(deferred);
  }

  function showFlash(flash: FlashItem) {
    isFlashingRef.current = true;
    if (flash.kind === "card") playSound("cardPlay");
    setActiveFlash(flash);
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

    const flashes = snapshot.transitions.flatMap((transition) => flashItemOf(transition) ?? []);
    if (flashes.length === 0) {
      applyQueuedSnapshot(snapshot);
      if (rest.length > 0) {
        setTimeout(startNextSnapshot, 0);
      } else {
        isFlashingRef.current = false;
        useGameStore.setState({ isFlashing: false });
      }
      return;
    }

    deferredSnapshotRef.current = snapshot;
    const [first, ...others] = flashes;
    flashQueueRef.current.push(...others);
    useGameStore.setState({ isFlashing: true });
    showFlash(first);
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
      deferredSnapshotRef.current = null;
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
        showFlash(next);
      } else {
        applyDeferredSnapshot();
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

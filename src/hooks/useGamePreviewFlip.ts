import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { animationsEnabled } from "@/pixi/effects/enabled";

export interface GamePreviewFlipHandle {
  close(): Promise<void>;
  open(): void;
  setClosed(): void;
  cancel(): void;
  isReady(): boolean;
}

export interface GamePreviewFlipBinding {
  handleRef: { current: GamePreviewFlipHandle | null };
  closed: boolean;
  onReady(): void;
}

export function useGamePreviewFlip(identity: string | null, active: boolean, presentation: string) {
  const printedRef = useRef<GamePreviewFlipHandle | null>(null);
  const rulesRef = useRef<GamePreviewFlipHandle | null>(null);
  const commandRef = useRef<GamePreviewFlipHandle | null>(null);
  const [flipState, setFlipState] = useState({ identity, active, closed: false });
  const sameScope = flipState.identity === identity && flipState.active === active;
  const closed = sameScope && flipState.closed;
  if (!sameScope) setFlipState({ identity, active, closed: false });
  const setClosed = useCallback((value: boolean) => {
    setFlipState((previous) => ({ ...previous, closed: value }));
  }, []);
  const state = useRef({
    generation: 0,
    phase: "idle" as "idle" | "closing" | "waiting",
    pending: null as { key: string; commit(): void } | null,
    expected: presentation,
  });
  const current = useRef({ active, presentation });
  useLayoutEffect(() => {
    current.current = { active, presentation };
  }, [active, presentation]);
  const handle = useCallback(() => {
    return current.current.presentation.startsWith("printed:")
      ? (commandRef.current ?? printedRef.current)
      : (rulesRef.current ?? commandRef.current);
  }, []);
  const reset = useCallback(() => {
    state.current.generation += 1;
    state.current.phase = "idle";
    state.current.pending = null;
    printedRef.current?.cancel();
    rulesRef.current?.cancel();
    commandRef.current?.cancel();
  }, []);
  const cancel = useCallback(() => {
    reset();
    setClosed(false);
  }, [reset, setClosed]);
  useLayoutEffect(() => {
    reset();
    return reset;
  }, [identity, active, reset]);

  const request = useCallback(
    (key: string, commit: () => void) => {
      const transition = state.current;
      transition.pending = { key, commit };
      if (transition.phase === "closing") return;
      if (transition.phase === "waiting") {
        transition.expected = key;
        commit();
        return;
      }
      if (!current.current.active) {
        cancel();
        commit();
        return;
      }
      const outgoing = handle();
      if (!animationsEnabled() || !outgoing?.isReady()) {
        cancel();
        commit();
        return;
      }
      const generation = ++transition.generation;
      transition.phase = "closing";
      void outgoing.close().then(() => {
        const latest = state.current;
        if (generation !== latest.generation || !current.current.active || !latest.pending) return;
        const pending = latest.pending;
        if (pending.key === current.current.presentation) {
          latest.phase = "idle";
          latest.pending = null;
          outgoing.open();
          return;
        }
        latest.phase = "waiting";
        latest.expected = pending.key;
        setClosed(true);
        pending.commit();
      });
    },
    [cancel, handle, setClosed],
  );
  const onReady = useCallback(() => {
    const transition = state.current;
    const flip = handle();
    if (
      transition.phase !== "waiting" ||
      !current.current.active ||
      current.current.presentation !== transition.expected ||
      !flip?.isReady()
    )
      return;
    transition.phase = "idle";
    transition.pending = null;
    flip.open();
    setClosed(false);
  }, [handle, setClosed]);
  return {
    request,
    printed: { handleRef: printedRef, closed, onReady } satisfies GamePreviewFlipBinding,
    rules: { handleRef: rulesRef, closed, onReady } satisfies GamePreviewFlipBinding,
    command: { handleRef: commandRef, closed, onReady } satisfies GamePreviewFlipBinding,
  };
}

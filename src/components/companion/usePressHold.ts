import { useCallback, useEffect, useRef } from "react";

interface PressHoldOptions {
  onTap: () => void;
  onHoldTick: () => void;
  holdDelayMs?: number;
  holdIntervalMs?: number;
}

/**
 * Returns props for a touch-target that fires `onTap` on a quick press and
 * `onHoldTick` repeatedly while the user keeps it pressed past `holdDelayMs`.
 */
export function usePressHold({
  onTap,
  onHoldTick,
  holdDelayMs = 320,
  holdIntervalMs = 110,
}: PressHoldOptions) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heldRef = useRef(false);

  const cleanup = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (tickTimer.current) {
      clearInterval(tickTimer.current);
      tickTimer.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      heldRef.current = false;
      cleanup();
      holdTimer.current = setTimeout(() => {
        heldRef.current = true;
        onHoldTick();
        tickTimer.current = setInterval(onHoldTick, holdIntervalMs);
      }, holdDelayMs);
    },
    [cleanup, holdDelayMs, holdIntervalMs, onHoldTick],
  );

  const finish = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      const wasHeld = heldRef.current;
      cleanup();
      if (!wasHeld) onTap();
      heldRef.current = false;
    },
    [cleanup, onTap],
  );

  const cancel = useCallback(() => {
    cleanup();
    heldRef.current = false;
  }, [cleanup]);

  return {
    onPointerDown: start,
    onPointerUp: finish,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
  };
}

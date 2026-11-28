import { useCallback, useEffect, useRef } from "react";

interface PressHoldOptions {
  onTap: () => void;
  onHoldTick: () => void;
  holdDelayMs?: number;
  holdIntervalMs?: number;
  maxMotion?: number;
}

export function usePressHold({
  onTap,
  onHoldTick,
  holdDelayMs = 320,
  holdIntervalMs = 110,
  maxMotion,
}: PressHoldOptions) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heldRef = useRef(false);
  const press = useRef<{ id: number; x: number; y: number } | null>(null);

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
      if (press.current || (event.pointerType === "mouse" && event.button !== 0)) return;
      press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      if (maxMotion !== undefined) {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
      heldRef.current = false;
      cleanup();
      holdTimer.current = setTimeout(() => {
        heldRef.current = true;
        onHoldTick();
        tickTimer.current = setInterval(onHoldTick, holdIntervalMs);
      }, holdDelayMs);
    },
    [cleanup, holdDelayMs, holdIntervalMs, maxMotion, onHoldTick],
  );

  const finish = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (press.current?.id !== event.pointerId) return;
      press.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      cleanup();
      if (maxMotion !== undefined && !heldRef.current) onTap();
    },
    [cleanup, maxMotion, onTap],
  );

  const cancel = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (press.current?.id !== event.pointerId) return;
      press.current = null;
      cleanup();
      heldRef.current = true;
    },
    [cleanup],
  );

  return {
    onPointerDown: start,
    onPointerUp: finish,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onLostPointerCapture: cancel,
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const origin = press.current;
      if (maxMotion === undefined || origin?.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > maxMotion) cancel(event);
    },
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (event.detail === 0 || (maxMotion === undefined && !heldRef.current)) onTap();
    },
  };
}

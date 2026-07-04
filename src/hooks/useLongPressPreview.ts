import { useEffect, useRef } from "react";
import { LONG_PRESS_CANCEL_DIST_SQ, LONG_PRESS_PREVIEW_MS } from "@/lib/responsive";

interface LongPressPreviewOptions<T> {
  resolve: (e: React.PointerEvent) => { item: T; anchor: HTMLElement } | null;
  show: (item: T, anchorRect: DOMRect) => void;
  hide: () => void;
}

export function useLongPressPreview<T>({ resolve, show, hide }: LongPressPreviewOptions<T>) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const firedRef = useRef(false);

  const cancelTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => cancelTimer, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // The compat click after a long-press is not guaranteed (iOS often skips it
    // after a hold, or the finger drifts past the tap slop) — a stale flag here
    // would swallow the NEXT unrelated click, so disarm on every new press.
    firedRef.current = false;
    if (e.pointerType !== "touch") return;
    const hit = resolve(e);
    if (!hit) return;
    cancelTimer();
    startRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      firedRef.current = true;
      show(hit.item, hit.anchor.getBoundingClientRect());
    }, LONG_PRESS_PREVIEW_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = startRef.current;
    if (!start || e.pointerId !== start.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > LONG_PRESS_CANCEL_DIST_SQ) cancelTimer();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const start = startRef.current;
    if (!start || e.pointerId !== start.pointerId) return;
    cancelTimer();
    startRef.current = null;
    // firedRef stays set until the compat click arrives so onClickCapture
    // can swallow the tap that would otherwise trigger the item's action.
    if (firedRef.current) hide();
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    const start = startRef.current;
    if (!start || e.pointerId !== start.pointerId) return;
    cancelTimer();
    startRef.current = null;
    if (firedRef.current) {
      hide();
      firedRef.current = false;
    }
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (!firedRef.current) return;
    firedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (startRef.current || firedRef.current) e.preventDefault();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
    onContextMenu,
  };
}

import { useEffect, useRef } from "react";
import { LongPressTimer } from "@/lib/longPress";

interface LongPressPreviewOptions<T> {
  resolve: (e: React.PointerEvent) => { item: T; anchor: HTMLElement } | null;
  show: (item: T, anchorRect: DOMRect) => void;
  hide: () => void;
}

export function useLongPressPreview<T>({ resolve, show, hide }: LongPressPreviewOptions<T>) {
  const timerRef = useRef<LongPressTimer | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const timer = (): LongPressTimer => (timerRef.current ??= new LongPressTimer());

  useEffect(() => () => timerRef.current?.cancel(), []);

  const onPointerDown = (e: React.PointerEvent) => {
    // The compat click after a long-press is not guaranteed (iOS often skips it
    // after a hold, or the finger drifts past the tap slop) — a stale flag here
    // would swallow the NEXT unrelated click, so disarm on every new press.
    firedRef.current = false;
    if (e.pointerType !== "touch") return;
    const hit = resolve(e);
    if (!hit) return;
    pointerIdRef.current = e.pointerId;
    timer().start(e.clientX, e.clientY, () => {
      firedRef.current = true;
      show(hit.item, hit.anchor.getBoundingClientRect());
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    timer().move(e.clientX, e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    timer().cancel();
    pointerIdRef.current = null;
    // firedRef stays set until the compat click arrives so onClickCapture
    // can swallow the tap that would otherwise trigger the item's action.
    if (firedRef.current) hide();
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    timer().cancel();
    pointerIdRef.current = null;
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
    if (pointerIdRef.current !== null || firedRef.current) e.preventDefault();
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

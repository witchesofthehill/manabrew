export function bindPreviewScroll(
  target: Window,
  hitTest: (x: number, y: number) => boolean,
  scroll: (delta: number, mode: number, clientY: number) => void,
): () => void {
  let touchId: number | null = null;
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || !hitTest(event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    scroll(event.deltaY, event.deltaMode, event.clientY);
  };
  const onTouchStart = (event: TouchEvent) => {
    if (touchId !== null) return;
    for (const touch of event.changedTouches) {
      if (!hitTest(touch.clientX, touch.clientY)) continue;
      touchId = touch.identifier;
      event.preventDefault();
      break;
    }
  };
  const onTouchMove = (event: TouchEvent) => {
    if (touchId === null) return;
    for (const touch of event.touches) {
      if (touch.identifier === touchId) {
        event.preventDefault();
        return;
      }
    }
  };
  const onTouchEnd = (event: TouchEvent) => {
    for (const touch of event.changedTouches) {
      if (touch.identifier === touchId) touchId = null;
    }
  };
  target.addEventListener("wheel", onWheel, { capture: true, passive: false });
  target.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
  target.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  target.addEventListener("touchend", onTouchEnd, { capture: true });
  target.addEventListener("touchcancel", onTouchEnd, { capture: true });
  return () => {
    target.removeEventListener("wheel", onWheel, { capture: true });
    target.removeEventListener("touchstart", onTouchStart, { capture: true });
    target.removeEventListener("touchmove", onTouchMove, { capture: true });
    target.removeEventListener("touchend", onTouchEnd, { capture: true });
    target.removeEventListener("touchcancel", onTouchEnd, { capture: true });
  };
}

interface PointerRoutingOptions {
  canvas: HTMLCanvasElement;
  hitTest: (clientX: number, clientY: number) => boolean;
  onActivity: () => void;
  onOverlayCancel: (pointerId: number) => void;
}

interface RoutedTouch {
  overlay: boolean;
  replayTarget: EventTarget | null;
  eventInit: PointerEventInit;
}

function eventInit(event: PointerEvent): PointerEventInit {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    button: event.button,
    buttons: event.buttons,
    pressure: event.pressure,
    width: event.width,
    height: event.height,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  };
}

export function installOverlayPointerRouting({
  canvas,
  hitTest,
  onActivity,
  onOverlayCancel,
}: PointerRoutingOptions): () => void {
  const routedTouches = new Map<number, RoutedTouch>();
  let mouseInteractive = false;
  const setInteractive = (interactive: boolean): void => {
    canvas.style.pointerEvents = interactive ? "auto" : "none";
  };
  const refreshInteractivity = (): void => {
    let interactive = mouseInteractive;
    for (const touch of routedTouches.values()) interactive ||= touch.overlay;
    setInteractive(interactive);
  };
  const dispatchReplay = (
    target: EventTarget,
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    init: PointerEventInit,
  ): void => {
    target.dispatchEvent(new PointerEvent(type, init));
  };
  const stopOriginal = (event: PointerEvent): void => {
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
  };

  const onMove = (event: PointerEvent): void => {
    if (!event.isTrusted) return;
    const routed = routedTouches.get(event.pointerId);
    if (routed) {
      refreshInteractivity();
      if (routed.overlay) onActivity();
      if (routed.replayTarget) {
        stopOriginal(event);
        dispatchReplay(routed.replayTarget, "pointermove", eventInit(event));
      }
      return;
    }
    if (event.pointerType === "touch") {
      refreshInteractivity();
      return;
    }
    mouseInteractive = hitTest(event.clientX, event.clientY);
    refreshInteractivity();
    onActivity();
  };

  const onDown = (event: PointerEvent): void => {
    if (!event.isTrusted || event.pointerType !== "touch") return;
    const pathIncludesCanvas = event.composedPath().includes(canvas);
    const overlay = hitTest(event.clientX, event.clientY);
    let replayTarget: EventTarget | null = null;

    if (overlay) {
      setInteractive(true);
      if (document.elementFromPoint(event.clientX, event.clientY) !== canvas) {
        refreshInteractivity();
        return;
      }
      if (!pathIncludesCanvas) replayTarget = canvas;
      onActivity();
    } else {
      setInteractive(false);
      if (pathIncludesCanvas) {
        const underlying = document.elementFromPoint(event.clientX, event.clientY);
        if (underlying && underlying !== canvas) replayTarget = underlying;
      }
    }

    if (!overlay && !replayTarget) {
      refreshInteractivity();
      return;
    }
    routedTouches.set(event.pointerId, {
      overlay,
      replayTarget,
      eventInit: eventInit(event),
    });
    refreshInteractivity();
    if (!replayTarget) return;
    stopOriginal(event);
    dispatchReplay(replayTarget, "pointerdown", eventInit(event));
  };

  const finishTouch = (type: "pointerup" | "pointercancel", event: PointerEvent): void => {
    if (!event.isTrusted) return;
    const routed = routedTouches.get(event.pointerId);
    if (!routed) return;

    routedTouches.delete(event.pointerId);
    if (routed.overlay) onActivity();
    if (type === "pointercancel" && routed.overlay) onOverlayCancel(event.pointerId);
    if (routed.replayTarget) {
      stopOriginal(event);
      dispatchReplay(routed.replayTarget, type, eventInit(event));
    }
    refreshInteractivity();
  };

  const onUp = (event: PointerEvent): void => finishTouch("pointerup", event);
  const onCancel = (event: PointerEvent): void => finishTouch("pointercancel", event);

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);

  return () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    for (const [pointerId, routed] of routedTouches) {
      if (routed.overlay) onOverlayCancel(pointerId);
      if (routed.replayTarget) {
        dispatchReplay(routed.replayTarget, "pointercancel", routed.eventInit);
      }
    }
    routedTouches.clear();
    mouseInteractive = false;
    setInteractive(false);
  };
}

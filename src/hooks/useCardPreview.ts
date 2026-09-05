import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { CardDto } from "@/protocol/game";
import { CardPreviewMachine } from "@/lib/cardPreview";
import { usePreferencesStore, type CardPreviewMode } from "@/stores/usePreferencesStore";

function isModifierHeld(
  e: Pick<KeyboardEvent, "shiftKey" | "altKey" | "ctrlKey" | "metaKey">,
  mode: CardPreviewMode,
): boolean {
  switch (mode) {
    case "click":
      return false;
    case "hover":
      return true;
    case "shift":
      return e.shiftKey;
    case "alt":
      return e.altKey;
    case "ctrl":
      return e.ctrlKey || e.metaKey;
  }
}

const ignorePreviewUpdates = () => () => undefined;

export interface HoverOptions {
  useAnchor?: boolean;
  placement?: "auto" | "top-center" | "pinned";
  anchorOverride?: DOMRect;
  useDelay?: boolean;
}

export function useCardPreview(dismissDeps: unknown[] = [], options: { subscribe?: boolean } = {}) {
  const machineRef = useRef<CardPreviewMachine | null>(null);
  machineRef.current ??= new CardPreviewMachine();
  const machine = machineRef.current;

  const snapshot = useSyncExternalStore(
    options.subscribe === false ? ignorePreviewUpdates : machine.subscribe,
    machine.getSnapshot,
  );

  const cardPreviewMode = usePreferencesStore((s) => s.cardPreviewMode);
  const cardHoverDelayMs = usePreferencesStore((s) => s.cardHoverDelayMs);
  const modeRef = useRef(cardPreviewMode);
  modeRef.current = cardPreviewMode;
  const delayRef = useRef(cardHoverDelayMs);
  delayRef.current = cardHoverDelayMs;
  const keysRef = useRef({ shiftKey: false, altKey: false, ctrlKey: false, metaKey: false });

  const handleMouseEnter = useCallback(
    (card: CardDto, e?: React.MouseEvent, options: HoverOptions = {}) => {
      if (e && e.buttons !== 0) {
        machine.dismiss();
        return;
      }
      if (!isModifierHeld(e ?? keysRef.current, modeRef.current)) return;
      machine.hoverStart(card, {
        pointer: e ? { x: e.clientX, y: e.clientY } : undefined,
        anchorRect:
          options.anchorOverride ??
          (options.useAnchor && e
            ? (e.currentTarget as HTMLElement).getBoundingClientRect()
            : null),
        placement: options.placement,
        delayMs: options.useDelay ? delayRef.current : 0,
      });
    },
    [machine],
  );

  const handleMouseLeave = useCallback(() => machine.hoverEnd(), [machine]);
  const onMouseEnterPreview = useCallback(() => machine.pointerEnterPreview(), [machine]);
  const onMouseLeavePreview = useCallback(() => machine.pointerLeavePreview(), [machine]);
  const dismiss = useCallback(() => machine.dismiss(), [machine]);
  const flipCard = useCallback(() => machine.flip(), [machine]);

  const showSticky = useCallback(
    (card: CardDto, x?: number, y?: number, anchor?: HTMLElement) => {
      machine.stick(card, {
        pointer: x != null && y != null ? { x, y } : undefined,
        anchorRect: anchor?.getBoundingClientRect() ?? null,
      });
    },
    [machine],
  );

  const lastDepsRef = useRef(dismissDeps);
  useEffect(() => {
    const prev = lastDepsRef.current;
    const changed =
      dismissDeps.length !== prev.length || dismissDeps.some((dep, i) => dep !== prev[i]);
    if (changed) {
      lastDepsRef.current = dismissDeps;
      machine.dismiss();
    }
  });

  useEffect(() => {
    if (!machine.getSnapshot().sticky) machine.dismiss();
    const updateKeys = (event: KeyboardEvent | PointerEvent) => {
      const wasHeld = isModifierHeld(keysRef.current, cardPreviewMode);
      keysRef.current.shiftKey = event.shiftKey;
      keysRef.current.altKey = event.altKey;
      keysRef.current.ctrlKey = event.ctrlKey;
      keysRef.current.metaKey = event.metaKey;
      if (wasHeld && !isModifierHeld(event, cardPreviewMode) && !machine.getSnapshot().sticky) {
        machine.dismiss();
      }
    };
    const clearKeys = () => {
      keysRef.current = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
      if (!machine.getSnapshot().sticky) machine.dismiss();
    };
    window.addEventListener("keydown", updateKeys, true);
    window.addEventListener("keyup", updateKeys, true);
    window.addEventListener("pointerover", updateKeys, true);
    window.addEventListener("pointerdown", updateKeys, true);
    window.addEventListener("pointermove", updateKeys, true);
    window.addEventListener("blur", clearKeys);
    return () => {
      window.removeEventListener("keydown", updateKeys, true);
      window.removeEventListener("keyup", updateKeys, true);
      window.removeEventListener("pointerover", updateKeys, true);
      window.removeEventListener("pointerdown", updateKeys, true);
      window.removeEventListener("pointermove", updateKeys, true);
      window.removeEventListener("blur", clearKeys);
    };
  }, [cardPreviewMode, machine]);

  useEffect(() => () => machine.destroy(), [machine]);

  return {
    subscribe: machine.subscribe,
    getSnapshot: machine.getSnapshot,
    hoveredCard: snapshot.card,
    phase: snapshot.phase,
    mousePos: snapshot.mousePos,
    anchorRect: snapshot.anchorRect,
    placement: snapshot.placement,
    showBackFace: snapshot.showBackFace,
    isSticky: snapshot.sticky,
    dismiss,
    flipCard,
    handleMouseEnter,
    handleMouseLeave,
    onMouseEnterPreview,
    onMouseLeavePreview,
    showSticky,
  };
}

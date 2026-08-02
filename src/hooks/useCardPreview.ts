import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { CardDto } from "@/protocol/game";
import { CardPreviewMachine } from "@/lib/cardPreview";
import { usePreferencesStore, type CardPreviewMode } from "@/stores/usePreferencesStore";

function isModifierHeld(e: React.MouseEvent | MouseEvent, mode: CardPreviewMode): boolean {
  switch (mode) {
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

const MODIFIER_KEYS: Record<string, CardPreviewMode[]> = {
  Shift: ["shift"],
  Alt: ["alt"],
  Control: ["ctrl"],
  Meta: ["ctrl"],
};

export interface HoverOptions {
  useAnchor?: boolean;
  placement?: "auto" | "top-center" | "pinned";
  anchorOverride?: DOMRect;
  useDelay?: boolean;
}

export function useCardPreview(dismissDeps: unknown[] = []) {
  const machineRef = useRef<CardPreviewMachine | null>(null);
  machineRef.current ??= new CardPreviewMachine();
  const machine = machineRef.current;

  const snapshot = useSyncExternalStore(machine.subscribe, machine.getSnapshot);

  const cardPreviewMode = usePreferencesStore((s) => s.cardPreviewMode);
  const cardHoverDelayMs = usePreferencesStore((s) => s.cardHoverDelayMs);
  const modeRef = useRef(cardPreviewMode);
  modeRef.current = cardPreviewMode;
  const delayRef = useRef(cardHoverDelayMs);
  delayRef.current = cardHoverDelayMs;

  const handleMouseEnter = useCallback(
    (card: CardDto, e?: React.MouseEvent, options: HoverOptions = {}) => {
      if (e && e.buttons !== 0) {
        machine.dismiss();
        return;
      }
      if (e && !isModifierHeld(e, modeRef.current)) return;
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
    if (cardPreviewMode === "hover") return;
    function handleKeyUp(e: KeyboardEvent) {
      if (MODIFIER_KEYS[e.key]?.includes(cardPreviewMode) && !machine.getSnapshot().sticky) {
        machine.dismiss();
      }
    }
    window.addEventListener("keyup", handleKeyUp);
    return () => window.removeEventListener("keyup", handleKeyUp);
  }, [cardPreviewMode, machine]);

  useEffect(() => () => machine.destroy(), [machine]);

  return {
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

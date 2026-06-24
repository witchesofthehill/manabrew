import { useState, useCallback, useRef, useEffect } from "react";
import type { CardDto } from "@/protocol/game";
import { usePreferencesStore, type CardPreviewMode } from "@/stores/usePreferencesStore";

/** Check whether the required modifier key is held for the given preview mode. */
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

export interface HoverOptions {
  useAnchor?: boolean;
  placement?: "auto" | "top-center" | "pinned";
  anchorOverride?: DOMRect;
  /** Whether to use the configured delay from preferences. */
  useDelay?: boolean;
  /** Whether the preview can be sticky (for interactive actions). */
  sticky?: boolean;
}

/**
 * Unified hook for managing card hover previews across the app.
 * Handles delay, modifier keys, sticky states, and grace periods.
 */
export function useCardPreview(dismissDeps: unknown[] = []) {
  const [hoveredCard, setHoveredCard] = useState<CardDto | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [placement, setPlacement] = useState<"auto" | "top-center" | "pinned">("auto");
  const [showBackFace, setShowBackFace] = useState(false);
  const [isSticky, setIsSticky] = useState(false);

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseOnPreviewRef = useRef(false);

  const cardPreviewMode = usePreferencesStore((s) => s.cardPreviewMode);
  const cardHoverDelayMs = usePreferencesStore((s) => s.cardHoverDelayMs);

  const dismiss = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    mouseOnPreviewRef.current = false;
    setHoveredCard(null);
    setAnchorRect(null);
    setPlacement("auto");
    setIsSticky(false);
    setShowBackFace(false);
  }, []);

  const handleMouseEnter = useCallback(
    (card: CardDto, e?: React.MouseEvent, options: HoverOptions = {}) => {
      // console.log("handleMouseEnter", card.name, { buttons: e?.buttons, mode: cardPreviewMode });
      // Never schedule hover preview while the mouse button is held (e.g. drag).
      if (e && e.buttons !== 0) {
        dismiss();
        return;
      }

      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }

      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      // Check modifier key requirement
      if (e && !isModifierHeld(e, cardPreviewMode)) {
        return;
      }

      // Don't switch cards while sticky — dismiss first
      if (isSticky) return;

      if (e) {
        setMousePos({ x: e.clientX, y: e.clientY });
      }
      if (options.anchorOverride) {
        setAnchorRect(options.anchorOverride);
      } else if (options.useAnchor && e) {
        setAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
      } else {
        setAnchorRect(null);
      }
      setPlacement(options.placement ?? "auto");

      const delay = options.useDelay ? cardHoverDelayMs : 0;

      // If a card is already showing, switch instantly; only debounce the initial show
      if (hoveredCard || delay === 0) {
        setHoveredCard(card);
        setShowBackFace(false);
      } else {
        hoverTimerRef.current = setTimeout(() => {
          setHoveredCard(card);
          setShowBackFace(false);
          hoverTimerRef.current = null;
        }, delay);
      }
    },
    [cardHoverDelayMs, cardPreviewMode, dismiss, hoveredCard, isSticky],
  );

  const handleMouseLeave = useCallback(() => {
    if (isSticky) return;

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    // If the cursor is currently sitting on the preview itself, don't
    // schedule a hide — the preview will call this again via its own
    // onMouseLeave when the cursor actually leaves.
    if (mouseOnPreviewRef.current) return;

    if (!hideTimerRef.current) {
      hideTimerRef.current = setTimeout(() => {
        setHoveredCard(null);
        setAnchorRect(null);
        setPlacement("auto");
        setShowBackFace(false);
        hideTimerRef.current = null;
      }, 250); // Grace period
    }
  }, [isSticky]);

  const onMouseEnterPreview = useCallback(() => {
    mouseOnPreviewRef.current = true;
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const onMouseLeavePreview = useCallback(() => {
    mouseOnPreviewRef.current = false;
    handleMouseLeave();
  }, [handleMouseLeave]);

  const makeSticky = useCallback(() => {
    if (hoveredCard) {
      setIsSticky(true);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    }
  }, [hoveredCard]);

  const showSticky = useCallback((card: CardDto, x?: number, y?: number, anchor?: HTMLElement) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (x != null && y != null) setMousePos({ x, y });
    if (anchor) {
      setAnchorRect(anchor.getBoundingClientRect());
    } else {
      setAnchorRect(null);
    }
    setPlacement("auto");
    setHoveredCard(card);
    setShowBackFace(false);
    setIsSticky(true);
  }, []);

  const flipCard = useCallback(() => {
    setShowBackFace((prev) => !prev);
  }, []);

  // Dismiss preview when dependencies change (e.g. state change in game)
  // We use a ref to track the last seen deps to avoid sync setState in effect if possible,
  // but clearing timers MUST happen in an effect.
  const lastDepsRef = useRef(dismissDeps);
  useEffect(() => {
    const changed =
      dismissDeps.length !== lastDepsRef.current.length ||
      dismissDeps.some((dep, i) => dep !== lastDepsRef.current[i]);
    if (changed) {
      setTimeout(() => dismiss(), 0);
      lastDepsRef.current = dismissDeps;
    }
  }, [dismiss, dismissDeps]);

  // Dismiss when modifier key is released
  useEffect(() => {
    if (cardPreviewMode === "hover") return;
    function handleKeyUp(e: KeyboardEvent) {
      const keyMap: Record<string, CardPreviewMode[]> = {
        Shift: ["shift"],
        Alt: ["alt"],
        Control: ["ctrl"],
        Meta: ["ctrl"],
      };
      if (keyMap[e.key]?.includes(cardPreviewMode) && !isSticky) {
        dismiss();
      }
    }
    window.addEventListener("keyup", handleKeyUp);
    return () => window.removeEventListener("keyup", handleKeyUp);
  }, [cardPreviewMode, isSticky, dismiss]);

  return {
    hoveredCard,
    mousePos,
    anchorRect,
    placement,
    showBackFace,
    isSticky,
    dismiss,
    flipCard,
    handleMouseEnter,
    handleMouseLeave,
    onMouseEnterPreview,
    onMouseLeavePreview,
    makeSticky,
    showSticky,
  };
}

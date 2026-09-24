import { useEffect, useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";

import { CardsInHandIcon } from "@/components/game/panels/CardsInHandIcon";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

import { cn } from "@/lib/utils";

const PEEK_HOLD_MS = 160;

interface MobileHandControlProps {
  count: number;
  open: boolean;
  locked: boolean;
  actionable: boolean;
  onToggle: () => void;
  onPeekStart?: () => void;
  onPeekEnd?: () => void;
  onBoundsChange?: (bounds: DOMRect | null) => void;
}

export function MobileHandControl({
  count,
  open,
  locked,
  actionable,
  onToggle,
  onPeekStart,
  onPeekEnd,
  onBoundsChange,
}: MobileHandControlProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const peekTimer = useRef<number | null>(null);
  const peeked = useRef(false);

  const cancelPeekTimer = () => {
    if (peekTimer.current !== null) {
      window.clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
  };
  const startPeekHold = () => {
    if (open || locked || count === 0) return;
    cancelPeekTimer();
    peekTimer.current = window.setTimeout(() => {
      peekTimer.current = null;
      peeked.current = true;
      onPeekStart?.();
    }, PEEK_HOLD_MS);
  };
  const endPeekHold = () => {
    cancelPeekTimer();
    onPeekEnd?.();
  };

  useEffect(() => () => cancelPeekTimer(), []);

  const leftHanded = usePreferencesStore((s) => s.mobileHandedness === "left");
  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!button || !onBoundsChange) return;
    const reportBounds = () => onBoundsChange(button.getBoundingClientRect());
    reportBounds();
    const observer = new ResizeObserver(reportBounds);
    observer.observe(button);
    window.addEventListener("resize", reportBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reportBounds);
    };
  }, [open, onBoundsChange]);

  useLayoutEffect(() => () => onBoundsChange?.(null), [onBoundsChange]);

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-label={
        open
          ? locked
            ? "Hand required"
            : "Close hand"
          : `Open hand, ${count} cards${actionable ? ", actions available" : ""}`
      }
      className={cn(
        "group pointer-events-auto absolute z-[4] flex h-11 items-center justify-center gap-2 px-3 font-game text-sm font-semibold tracking-wide text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-card-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:transition-[color,opacity,transform] active:scale-[0.98]",
        open
          ? leftHanded
            ? "left-2 top-2"
            : "right-2 top-2"
          : "bottom-0 left-1/2 -translate-x-1/2",
        (locked || count === 0) && "opacity-70",
      )}
      disabled={locked || count === 0}
      onClick={() => {
        if (peeked.current) {
          peeked.current = false;
          return;
        }
        onToggle();
      }}
      onPointerDown={startPeekHold}
      onPointerUp={endPeekHold}
      onPointerLeave={endPeekHold}
      onPointerCancel={endPeekHold}
    >
      {open ? (
        <X className="h-4 w-4" aria-hidden />
      ) : (
        <CardsInHandIcon count={count} className="h-7 w-9" />
      )}
      {open ? (locked ? "Select cards" : "Close") : count}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-0 left-1/2 h-0.5 w-16 -translate-x-1/2 bg-foreground/25 motion-safe:transition-[width,height,background-color,box-shadow]",
          actionable && !open && "h-[3px] w-24 bg-card-ring shadow-[0_0_12px_var(--card-ring)]",
        )}
      />
    </button>
  );
}

import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface TouchHintPopoverProps {
  anchorRect: DOMRect;
  children: React.ReactNode;
  className?: string;
}

/** Transient hint card shown while a long-press is held — anchored above the
 *  pressed element, clamped to the viewport, never interactive. */
export function TouchHintPopover({ anchorRect, children, className }: TouchHintPopoverProps) {
  return createPortal(
    <div
      className={cn(
        "pointer-events-none fixed z-[9000] flex max-h-[55dvh] max-w-[16rem] flex-col gap-1.5 overflow-hidden rounded-lg border border-border/70 bg-card/95 px-3 py-2 shadow-lg backdrop-blur-sm",
        className,
      )}
      style={{
        right: Math.max(8, window.innerWidth - anchorRect.right),
        bottom: Math.min(window.innerHeight - 8, window.innerHeight - anchorRect.top + 8),
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

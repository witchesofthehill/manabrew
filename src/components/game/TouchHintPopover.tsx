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
        "pointer-events-none fixed z-[9000] flex flex-col gap-1.5 overflow-hidden rounded-lg border border-border/70 bg-card/95 px-3 py-2 shadow-lg backdrop-blur-sm",
        className,
      )}
      style={{
        right: Math.max(8, window.innerWidth - anchorRect.right),
        bottom: Math.min(window.innerHeight - 8, window.innerHeight - anchorRect.top + 8),
        // Anchored right/bottom, so width/height caps keep the left and top
        // edges on-screen for anchors near those viewport edges.
        maxWidth: Math.min(256, Math.max(120, anchorRect.right - 8)),
        maxHeight: Math.min(window.innerHeight * 0.55, Math.max(48, anchorRect.top - 16)),
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

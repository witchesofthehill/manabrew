import { createPortal } from "react-dom";
import { useContext, useEffect, useRef } from "react";
import { Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PromptModalChromeContext } from "./promptModalChrome.context";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { useIsTouch } from "@/hooks/useBreakpoints";
import { GHOST_CLICK_ARM_MS } from "@/lib/responsive";
import { useGameStore } from "@/stores/useGameStore";

interface ModalProps {
  children: React.ReactNode;
  /** Called when the user clicks the backdrop or presses Escape. If omitted, backdrop click and Escape are disabled. */
  onClose?: () => void;
  /** Max width class for the modal panel (default: "max-w-2xl") */
  maxWidth?: string;
  maxHeight?: string;
  /** Additional className for the modal panel */
  className?: string;
  /** Additional className for the backdrop overlay (e.g. z-index overrides) */
  backdropClassName?: string;
}

/**
 * Reusable modal wrapper. Renders a portal into document.body with:
 * - Dark backdrop with blur
 * - Centered panel with animation
 * - Escape key to close
 * - Click-outside to close
 *
 * Use the compound sub-components (Modal.Header, Modal.Body, etc.) for consistent layout.
 */
export function Modal({
  children,
  onClose,
  maxWidth = "max-w-2xl",
  maxHeight = "max-h-[85dvh]",
  className,
  backdropClassName,
}: ModalProps) {
  const promptChrome = useContext(PromptModalChromeContext);
  const isTouch = useIsTouch();
  const isGameActive = useGameStore((s) => s.isGameActive);
  const touchGameSurface = isTouch && isGameActive;

  useEffect(() => {
    if (!onClose) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose!();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Backdrop dismissal is click-based but armed after a short delay: a touch
  // tap on a Pixi surface that opens a modal fires its synthetic click AFTER
  // the modal mounts (it would close instantly), while dismissing on
  // pointerdown unmounts the backdrop before the tap's click dispatches — the
  // click then retargets to whatever game control sat underneath.
  const dismissArmedRef = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      dismissArmedRef.current = true;
    }, GHOST_CLICK_ARM_MS);
    return () => clearTimeout(timer);
  }, []);

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 backdrop-blur-sm",
        touchGameSurface && "game-touch-surface",
        backdropClassName,
      )}
      onClick={() => {
        if (dismissArmedRef.current) onClose?.();
      }}
    >
      <div
        data-modal-panel="true"
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative bg-card border rounded-xl shadow-2xl flex flex-col w-full mx-4 animate-in fade-in zoom-in-95 duration-200",
          maxWidth,
          maxHeight || "max-h-[calc(100dvh-1rem)]",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDownCapture={(e) => {
          if (e.code === "Space" && e.target instanceof HTMLButtonElement) {
            e.preventDefault();
          }
        }}
      >
        {promptChrome.showMinimize && promptChrome.onMinimize && (
          <button
            className="absolute -top-3 -right-3 z-10 rounded-full border border-border bg-card p-1.5 shadow-[0_8px_20px_rgba(0,0,0,0.35)] hover:bg-muted transition-colors before:absolute before:-inset-2.5 before:content-['']"
            onClick={promptChrome.onMinimize}
            title="Minimize prompt"
            type="button"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

interface ModalHeaderProps {
  children: React.ReactNode;
  onClose?: () => void;
  /** Additional className */
  className?: string;
}

function ModalHeader({ children, onClose, className }: ModalHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between px-4 py-3 border-b", className)}>
      <div className="flex-1 min-w-0">{children}</div>
      {onClose && (
        <button
          className="relative rounded-md p-1 hover:bg-muted transition-colors shrink-0 ml-2 before:absolute before:-inset-2.5 before:content-['']"
          onClick={onClose}
          title="Close (Esc)"
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

interface ModalInstructionsProps {
  children: React.ReactNode;
  className?: string;
}

function ModalInstructions({ children, className }: ModalInstructionsProps) {
  const themeColors = useTheme().gameTheme;
  const infoColor = themeColors.promptAction.defenseAction;

  return (
    <div
      className={cn("px-4 py-2 border-b", className)}
      style={{ backgroundColor: withAlpha(infoColor, 0.08) }}
    >
      <p className="text-sm font-semibold text-center" style={{ color: infoColor }}>
        {children}
      </p>
    </div>
  );
}

interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
}

function ModalBody({ children, className }: ModalBodyProps) {
  return <div className={cn("overflow-y-auto p-4 flex-1", className)}>{children}</div>;
}

interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div className={cn("flex items-center justify-end px-4 py-3 border-t", className)}>
      {children}
    </div>
  );
}

interface ModalEmptyStateProps {
  message?: string;
}

function ModalEmptyState({ message = "No cards" }: ModalEmptyStateProps) {
  return <p className="text-sm text-muted-foreground italic text-center py-8">{message}</p>;
}

Modal.Header = ModalHeader;
Modal.Instructions = ModalInstructions;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
Modal.EmptyState = ModalEmptyState;

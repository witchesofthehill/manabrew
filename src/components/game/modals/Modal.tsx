import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { useIsTouch } from "@/hooks/useBreakpoints";
import { useKeybindings } from "@/hooks/useKeybindings";
import { GHOST_CLICK_ARM_MS } from "@/lib/responsive";
import { useGameStore } from "@/stores/useGameStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { modalFocusables, registerModal, topModal, MODAL_BASE_Z_INDEX } from "@/lib/modalStack";

const ModalTitleContext = createContext<string | undefined>(undefined);
const ModalCloseContext = createContext<(callback: () => void) => void>((callback) => callback());

const ModalParentContext = createContext<RefObject<HTMLDivElement | null> | null>(null);
const ENTER_MS = 180;
const EXIT_MS = 120;

interface ModalProps {
  children: ReactNode;
  onClose?: () => void;
  ariaLabel?: string;
  maxWidth?: string;
  maxHeight?: string;
  className?: string;
  backdropClassName?: string;
}

export function Modal({
  children,
  onClose,
  ariaLabel,
  maxWidth = "max-w-2xl",
  maxHeight = "max-h-[90dvh]",
  className,
  backdropClassName,
}: ModalProps) {
  const isTouch = useIsTouch();
  const isGameActive = useGameStore((s) => s.isGameActive);
  const motion = usePreferencesStore((s) => s.inGameAnimations);
  const panelRef = useRef<HTMLDivElement>(null);
  const parentPanel = useContext(ModalParentContext);
  const [previousFocus] = useState(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const closing = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const animation = useRef<Animation | null>(null);
  const dismissArmed = useRef(false);
  const titleId = useId();
  const close = useCallback(
    (callback: () => void) => {
      const panel = panelRef.current;
      if (!panel || topModal() !== panel || closing.current) return;
      closing.current = true;
      panel.dataset.closing = "true";
      if (!motion || !animationsEnabled()) {
        callback();
        return;
      }
      panel.parentElement!.inert = true;
      animation.current?.cancel();
      animation.current = panel.animate(
        [{ opacity: 1 }, { opacity: 0, transform: "translateY(4px)" }],
        { duration: EXIT_MS, fill: "forwards", easing: "ease-in" },
      );
      closeTimer.current = window.setTimeout(callback, EXIT_MS);
    },
    [motion],
  );

  useEffect(() => {
    const panel = panelRef.current!;
    const previous = previousFocus;
    const unregister = registerModal(panel, parentPanel?.current ?? undefined, previous);
    const frame = requestAnimationFrame(() => {
      if (topModal() !== panel) return;
      const focusable = modalFocusables(panel);
      (
        focusable.find((node) => node.matches("[autofocus], [data-autofocus]")) ??
        focusable[0] ??
        panel
      ).focus();
    });
    const focus = (event: FocusEvent) => {
      if (topModal() !== panel || closing.current || panel.contains(event.target as Node)) return;
      (modalFocusables(panel)[0] ?? panel).focus();
    };
    document.addEventListener("focusin", focus);
    const timer = setTimeout(() => {
      dismissArmed.current = true;
    }, GHOST_CLICK_ARM_MS);
    return () => {
      const wasTop = topModal() === panel;
      unregister();
      document.removeEventListener("focusin", focus);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      clearTimeout(closeTimer.current);
      animation.current?.cancel();
      if (wasTop && previous?.isConnected && !previous.closest("[inert]")) previous.focus();
    };
  }, [parentPanel, previousFocus]);

  useEffect(() => {
    animation.current?.cancel();
    if (motion && animationsEnabled() && !closing.current) {
      animation.current = panelRef.current!.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: ENTER_MS, easing: "cubic-bezier(0.16,1,0.3,1)" },
      );
    }
  }, [motion]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        topModal() !== panelRef.current ||
        event.defaultPrevented ||
        event.isComposing ||
        event.key !== "Escape"
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (onClose) close(onClose);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [close, onClose]);

  return createPortal(
    <div
      style={{ zIndex: MODAL_BASE_Z_INDEX }}
      className={cn(
        "fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm pb-[var(--safe-area-inset-bottom)] pl-[var(--safe-area-inset-left)] pr-[var(--safe-area-inset-right)] pt-[var(--safe-area-inset-top)]",
        isTouch && isGameActive && "game-touch-surface",
        backdropClassName,
      )}
      onClick={() => {
        if (dismissArmed.current && onClose) close(onClose);
      }}
    >
      <div
        ref={panelRef}
        data-modal-panel="true"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        tabIndex={-1}
        className={cn(
          "relative bg-card border border-border rounded-xl shadow-2xl flex flex-col w-full mx-3 min-h-0",
          maxWidth,
          maxHeight ||
            "max-h-[calc(100dvh-1rem-var(--safe-area-inset-top)-var(--safe-area-inset-bottom))]",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Tab" || topModal() !== panelRef.current) return;
          const panel = panelRef.current!;
          const focusable = modalFocusables(panel);
          const first = focusable[0],
            last = focusable.at(-1);
          if (!first || !last) {
            event.preventDefault();
            panel.focus();
          } else if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === panel)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <ModalTitleContext.Provider value={titleId}>
          <ModalCloseContext.Provider value={close}>
            <ModalParentContext.Provider value={panelRef}>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
            </ModalParentContext.Provider>
          </ModalCloseContext.Provider>
        </ModalTitleContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

function ModalHeader({
  children,
  onClose,
  className,
}: {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  const id = useContext(ModalTitleContext);
  const close = useContext(ModalCloseContext);
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3 border-b shrink-0",
        className,
      )}
    >
      <div id={id} className="flex-1 min-w-0">
        {children}
      </div>
      {onClose && (
        <Button
          size="icon"
          variant="ghost"
          onClick={() => close(onClose)}
          title="Close (Esc)"
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function ModalInstructions({ children, className }: { children: ReactNode; className?: string }) {
  const color = useTheme().gameTheme.promptAction.defenseAction;
  return (
    <div
      className={cn("px-4 py-2 border-b shrink-0", className)}
      style={{ backgroundColor: withAlpha(color, 0.08) }}
    >
      <p className="text-sm font-semibold text-center" style={{ color }}>
        {children}
      </p>
    </div>
  );
}
function ModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-h-0 overflow-y-auto overscroll-contain p-4 flex-1", className)}>
      {children}
    </div>
  );
}
function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t shrink-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
function ModalClose({
  onClose,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick"> & { onClose: () => void }) {
  const close = useContext(ModalCloseContext);
  return <Button {...props} onClick={() => close(onClose)} />;
}
function ModalCloseShortcut({ keybinding, onClose }: { keybinding: string; onClose: () => void }) {
  const close = useContext(ModalCloseContext);
  const scope = useContext(ModalParentContext);
  useKeybindings({ [keybinding]: () => close(onClose) }, scope ?? undefined);
  return null;
}
function ModalEmptyState({ message = "No cards" }: { message?: string }) {
  return (
    <p className="text-sm text-muted-foreground text-center py-8" role="status">
      {message}
    </p>
  );
}
Modal.Header = ModalHeader;
Modal.Instructions = ModalInstructions;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
Modal.EmptyState = ModalEmptyState;
Modal.Close = ModalClose;
Modal.CloseShortcut = ModalCloseShortcut;

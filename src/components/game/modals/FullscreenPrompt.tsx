import type { ComponentProps, KeyboardEventHandler, ReactNode, RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Modal } from "./Modal";

interface FullscreenPromptProps {
  children: ReactNode;
  label: string;
  onClose?: () => void;
  scopeRef?: RefObject<HTMLDivElement | null>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  className?: string;
}

export function FullscreenPrompt({
  children,
  label,
  onClose,
  scopeRef,
  onKeyDown,
  className,
}: FullscreenPromptProps) {
  return (
    <Modal
      ariaLabel={label}
      onClose={onClose}
      maxWidth="max-w-none"
      maxHeight="max-h-none"
      backdropClassName="bg-background/70 backdrop-blur-[4px]"
      className="m-0 h-full w-full rounded-none border-0 bg-transparent shadow-none"
    >
      <div
        ref={scopeRef}
        data-autofocus
        tabIndex={0}
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-hidden outline-none",
          className,
        )}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onPointerCancel={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </Modal>
  );
}

function FullscreenPromptHeader({
  children,
  className,
  panelClassName,
}: {
  children: ReactNode;
  className?: string;
  panelClassName?: string;
}) {
  return (
    <header
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-3 sm:px-6 sm:pt-5",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-auto mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-2xl border bg-card/95 p-2 shadow-2xl backdrop-blur-xl sm:flex-nowrap sm:gap-3",
          panelClassName,
        )}
      >
        {children}
      </div>
    </header>
  );
}

function FullscreenPromptTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("min-w-0 flex-1 px-2", className)}>{children}</div>;
}

function FullscreenPromptStage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative min-h-0 flex-1 pb-24 pt-24 sm:pb-28 sm:pt-24", className)}>
      {children}
    </div>
  );
}

function FullscreenPromptFooter({
  children,
  className,
  panelClassName,
}: {
  children: ReactNode;
  className?: string;
  panelClassName?: string;
}) {
  return (
    <footer
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-3 sm:px-6 sm:pb-5",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-auto mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl border bg-card/95 p-3 shadow-2xl backdrop-blur-xl sm:flex-nowrap",
          panelClassName,
        )}
      >
        {children}
      </div>
    </footer>
  );
}

function FullscreenPromptActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ml-auto flex shrink-0 items-center gap-2", className)}>{children}</div>
  );
}

type FullscreenPromptCloseProps = Omit<
  ComponentProps<typeof Button>,
  "children" | "onClick" | "size" | "variant"
> & {
  onClose: () => void;
  label?: string;
};

function FullscreenPromptClose({
  onClose,
  label = "Close prompt",
  ...props
}: FullscreenPromptCloseProps) {
  return (
    <Modal.Close {...props} onClose={onClose} size="icon" variant="ghost" aria-label={label}>
      <X className="h-4 w-4" />
    </Modal.Close>
  );
}

FullscreenPrompt.Header = FullscreenPromptHeader;
FullscreenPrompt.Title = FullscreenPromptTitle;
FullscreenPrompt.Stage = FullscreenPromptStage;
FullscreenPrompt.Footer = FullscreenPromptFooter;
FullscreenPrompt.Actions = FullscreenPromptActions;
FullscreenPrompt.Close = FullscreenPromptClose;

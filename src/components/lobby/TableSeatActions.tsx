import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import { Bot, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

const BUBBLE_CLASS =
  "flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-full border border-border bg-popover p-2 text-center text-ui-meta font-medium text-popover-foreground shadow-md outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground [--seat-action-shift-y:24px] group-data-[side=bottom]/seat-actions:[--seat-action-shift-y:-24px] group-data-[state=open]/seat-actions:animate-seat-bubble-in group-data-[state=closed]/seat-actions:animate-seat-bubble-out motion-reduce:animate-none!";

interface TableSeatActionsProps {
  seatIndex: number;
  onAddBot?: () => void;
  onInvitePlayer?: () => void;
  children: ReactElement;
}

export function TableSeatActions({
  seatIndex,
  onAddBot,
  onInvitePlayer,
  children,
}: TableSeatActionsProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const activation = useRef<"hover" | "focus" | "press" | "keyboard">("hover");
  const pointerDown = useRef(false);
  const suppressFocusOpen = useRef(false);
  const restoreFocus = useRef(false);

  function cancelClose() {
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  function changeOpen(nextOpen: boolean) {
    cancelClose();
    setOpen(nextOpen);
  }

  function scheduleClose() {
    if (activation.current !== "hover") return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => changeOpen(false), 180);
  }

  function markKeyboard() {
    cancelClose();
    activation.current = "keyboard";
    restoreFocus.current = true;
  }

  function selectAction(action: () => void) {
    restoreFocus.current = false;
    flushSync(() => changeOpen(false));
    action();
  }

  return (
    <Popover.Root modal={false} open={open} onOpenChange={changeOpen}>
      <Popover.Trigger
        asChild
        ref={triggerRef}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          cancelClose();
          if (open) return;
          activation.current = "hover";
          restoreFocus.current = false;
          changeOpen(true);
        }}
        onPointerLeave={scheduleClose}
        onPointerDown={() => {
          cancelClose();
          pointerDown.current = true;
          activation.current = "press";
          restoreFocus.current = false;
        }}
        onPointerUp={() => {
          pointerDown.current = false;
        }}
        onPointerCancel={() => {
          pointerDown.current = false;
        }}
        onKeyDown={(event) => {
          markKeyboard();
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (!open) {
            changeOpen(true);
            return;
          }
          const buttons = contentRef.current?.querySelectorAll("button");
          const button = event.key === "ArrowUp" ? buttons?.[buttons.length - 1] : buttons?.[0];
          button?.focus();
        }}
        onFocus={(event) => {
          if (
            pointerDown.current ||
            suppressFocusOpen.current ||
            !event.currentTarget.matches(":focus-visible")
          )
            return;
          activation.current = "focus";
          restoreFocus.current = true;
          changeOpen(true);
        }}
        onBlur={(event) => {
          pointerDown.current = false;
          if (!contentRef.current?.contains(event.relatedTarget)) {
            restoreFocus.current = false;
            changeOpen(false);
          }
        }}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          aria-label={`Seat ${seatIndex + 1} actions`}
          side="top"
          align="center"
          sideOffset={0}
          collisionPadding={12}
          className="group/seat-actions z-50 flex gap-3 p-3 outline-none data-[state=open]:animate-seat-actions-in data-[state=closed]:animate-seat-actions-out data-[state=closed]:pointer-events-none motion-reduce:animate-none!"
          onOpenAutoFocus={(event) => {
            if (activation.current === "hover") event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (restoreFocus.current && triggerRef.current?.isConnected) {
              suppressFocusOpen.current = true;
              triggerRef.current.focus();
              suppressFocusOpen.current = false;
            }
          }}
          onEscapeKeyDown={() => {
            restoreFocus.current = true;
          }}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
          onKeyDown={(event) => {
            markKeyboard();
            if (
              !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            const buttons = event.currentTarget.querySelectorAll("button");
            const current = Array.from(buttons).findIndex(
              (button) => button === document.activeElement,
            );
            let next =
              (current +
                (event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1) +
                buttons.length) %
              buttons.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = buttons.length - 1;
            buttons[next]?.focus();
          }}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget) &&
              event.relatedTarget !== triggerRef.current
            ) {
              restoreFocus.current = false;
              changeOpen(false);
            }
          }}
        >
          {onAddBot && (
            <button
              type="button"
              onClick={() => selectAction(onAddBot)}
              className={cn(
                BUBBLE_CLASS,
                onInvitePlayer ? "[--seat-action-shift-x:24px]" : "[--seat-action-shift-x:0px]",
              )}
              disabled={!open}
            >
              <Bot aria-hidden="true" className="h-5 w-5" />
              <span>Add bot</span>
            </button>
          )}
          {onInvitePlayer && (
            <button
              type="button"
              onClick={() => selectAction(onInvitePlayer)}
              className={cn(
                BUBBLE_CLASS,
                onAddBot ? "[--seat-action-shift-x:-24px]" : "[--seat-action-shift-x:0px]",
              )}
              disabled={!open}
            >
              <UserPlus aria-hidden="true" className="h-5 w-5" />
              <span>Invite player</span>
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

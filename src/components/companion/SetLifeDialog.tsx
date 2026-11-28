import { useRef, useState } from "react";
import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "−", "0", "Backspace"];

export function SetLifeDialog({
  player,
  onClose,
  returnFocus,
}: {
  player: CompanionPlayer;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const setLife = useCompanionStore((state) => state.setLife);
  const panel = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState({ text: String(player.life), replace: true });
  const value = Number(draft.text);
  const canApply = draft.text !== "" && Number.isSafeInteger(value);
  function press(key: string) {
    setDraft(({ text, replace }) => {
      if (key === "Backspace") return { text: text.slice(0, -1), replace: false };
      if (key === "-" && replace) return { text: "-", replace: false };
      if (key === "−" || key === "-") {
        return { text: text.startsWith("-") ? text.slice(1) : `-${text}`, replace: false };
      }
      const next = replace || text === "0" ? key : `${text === "-0" ? "-" : text}${key}`;
      return Number.isSafeInteger(Number(next))
        ? { text: next, replace: false }
        : { text, replace };
    });
  }

  function apply() {
    if (!canApply) return;
    setLife(player.id, value);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={panel}
        tabIndex={-1}
        className="max-w-xs gap-3 p-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          panel.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key === "Enter" && event.target === event.currentTarget) {
            event.preventDefault();
            apply();
          } else if (/^[0-9-]$/.test(event.key) || event.key === "Backspace") {
            event.preventDefault();
            press(event.key);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Set life</DialogTitle>
          <DialogDescription className="break-words">
            {player.name} has {player.life} life
          </DialogDescription>
        </DialogHeader>
        <output
          className="min-h-12 break-all rounded-md bg-muted px-2 py-1 text-center text-3xl font-bold tabular-nums"
          aria-label="New life total"
        >
          {draft.text || "–"}
        </output>
        <div className="grid grid-cols-3 gap-1.5">
          {KEYS.map((key) => (
            <Button
              key={key}
              variant="outline"
              className="h-11 text-lg tabular-nums"
              aria-label={key === "−" ? "Change sign" : key === "Backspace" ? "Delete digit" : key}
              onClick={() => press(key)}
            >
              {key === "Backspace" ? <Delete aria-hidden /> : key === "−" ? "±" : key}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" className="h-11" onClick={apply} disabled={!canApply}>
            Set life
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

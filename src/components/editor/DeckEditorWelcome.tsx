import { useEffect, useState } from "react";
import { Command, Layers, LibraryBig, MousePointer2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DECK_EDITOR_WELCOME_EVENT } from "./deckEditorWelcome.actions";

const STORAGE_KEY = "manabrew-deck-editor-welcome-v1";

const STEPS = [
  {
    title: "Build at your speed",
    description:
      "Quick Add adds a card in one click. The command palette puts every editor action under Cmd/Ctrl+P.",
    icon: Command,
  },
  {
    title: "Select and move together",
    description:
      "Shift-click ranges, Cmd/Ctrl-click individual cards, then drag or use M, S, and B to move the selection.",
    icon: MousePointer2,
  },
  {
    title: "See what you own",
    description:
      "Solid highlights mean the exact printing is owned; dashed highlights mean another printing is in your collection.",
    icon: LibraryBig,
  },
  {
    title: "Shape the workspace",
    description:
      "Save layouts for collection gaps, tags, mana review, or any combination of view, grouping, sorting, and filters.",
    icon: Layers,
  },
];

export function DeckEditorWelcome({ readOnly }: { readOnly: boolean }) {
  const [open, setOpen] = useState(
    () => !readOnly && localStorage.getItem(STORAGE_KEY) !== "dismissed",
  );
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const Icon = current.icon;

  useEffect(() => {
    const openWelcome = () => {
      if (!readOnly) {
        setStep(0);
        setOpen(true);
      }
    };
    window.addEventListener(DECK_EDITOR_WELCOME_EVENT, openWelcome);
    return () => window.removeEventListener(DECK_EDITOR_WELCOME_EVENT, openWelcome);
  }, [readOnly]);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "dismissed");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && dismiss()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.description}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((item, index) => (
            <div
              key={item.title}
              className={
                index === step ? "h-1 flex-1 rounded bg-primary" : "h-1 flex-1 rounded bg-muted"
              }
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={dismiss}>
            Skip
          </Button>
          <Button onClick={() => (step === STEPS.length - 1 ? dismiss() : setStep(step + 1))}>
            {step === STEPS.length - 1 ? "Start building" : "Next"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

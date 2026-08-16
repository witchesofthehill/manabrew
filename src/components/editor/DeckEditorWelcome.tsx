import { useEffect, useState } from "react";
import {
  BarChart3,
  Command,
  Eye,
  Layers,
  LibraryBig,
  MousePointer2,
  Search,
  Sparkles,
} from "lucide-react";

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
    title: "Add cards quickly",
    description:
      "Quick Add adds the first result in one click. Open Card Search for richer discovery, then use its add controls or drag results directly into your deck.",
    icon: Command,
    tips: ["Option/Alt+A focuses Quick Add", "Option/Alt+S toggles Card Search"],
  },
  {
    title: "Search with Scryfall syntax",
    description:
      "Card Search accepts normal card names and Scryfall filters. Combine filters to narrow results by color, type, rules text, set, price, and more.",
    icon: Search,
    tips: ["c:ur t:instant", 'o:"draw a card" mv<=2', "set:mh3 usd<5"],
  },
  {
    title: "Select and move together",
    description:
      "Shift-click ranges, Cmd/Ctrl-click individual cards, then drag or use M, S, and B to move the selection.",
    icon: MousePointer2,
    tips: ["Right-click any card for all card actions", "Drag a selection to sections or tags"],
  },
  {
    title: "Organize your way",
    description:
      "Choose list, grid, or stack view. Sort independently, group by card properties or your own tags, and save useful combinations as custom views.",
    icon: Layers,
    tips: [
      "Collapse sections you do not need",
      "Use the command palette to fold or expand everything",
    ],
  },
  {
    title: "Preview cards from anywhere",
    description:
      "The Preview rail is the editor's shared card inspector. Hover a card anywhere in the workspace and its image and details appear there without interrupting what you are doing.",
    icon: Eye,
    tips: [
      "Works with deck cards, Card Search, replacements, tokens, the command zone, and collection coverage",
      "Option/Alt+P toggles the Preview rail",
    ],
  },
  {
    title: "Track cards and printings",
    description:
      "Collection highlights distinguish an exact printing from another printing you own. Change individual printings or optimize the whole deck for collection, finish, or price.",
    icon: LibraryBig,
    tips: ["Solid border: exact printing owned", "Dashed border: another printing owned"],
  },
  {
    title: "Review and refine",
    description:
      "Deck Analysis brings legality, roles, mana, collection coverage, budget, tokens, and replacements together. Every section can be collapsed when you want a quieter workspace.",
    icon: BarChart3,
    tips: ["Hover cards to inspect them in Preview", "Set your preferred budget price provider"],
  },
  {
    title: "Work from the keyboard",
    description:
      "Open the command palette with Cmd/Ctrl+Shift+P to find editor actions. Undo, redo, save, search, section navigation, and bulk edits all have shortcuts.",
    icon: Sparkles,
    tips: ["Press ? to see every shortcut", "Shortcuts can be customized in Preferences"],
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.description}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/25 p-3">
          <ul className="space-y-2 text-sm text-foreground">
            {current.tips.map((tip) => (
              <li key={tip} className="flex gap-2">
                <span className="text-primary" aria-hidden="true">
                  •
                </span>
                <span className="font-mono text-xs leading-5">{tip}</span>
              </li>
            ))}
          </ul>
        </div>
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

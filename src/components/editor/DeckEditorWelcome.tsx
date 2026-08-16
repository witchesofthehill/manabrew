import { useEffect, useState } from "react";
import {
  BarChart3,
  Command,
  Eye,
  Layers,
  LibraryBig,
  MousePointer2,
  Save,
  Search,
  ShieldCheck,
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
      "Choose text, grid, or stack view. Sort cards, group by card properties or your own tags, and save useful combinations as custom views.",
    icon: Layers,
    tips: [
      "Collapse sections you do not need",
      "Use the command palette to fold or expand everything",
    ],
  },
  {
    title: "Use every action in every view",
    description:
      "Text, grid, and stack views expose the same card actions. Adjust quantities, set commanders, change printings and foil treatment, choose the deck cover, move cards, or open full card details.",
    icon: MousePointer2,
    tips: [
      "Right-click a card to open the complete action menu",
      "Command zone cards use the same actions as deck cards",
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
      "Collection highlights distinguish an exact printing from another printing you own. Hover the ownership pill when you want printing and quantity details without covering the card during normal browsing.",
    icon: LibraryBig,
    tips: [
      "Solid border and check pill: exact printing owned",
      "Dashed border and layers pill: another printing owned",
      "The pill shows owned/required quantities, including partial ownership",
      "Use View in My Collection inside the tooltip to inspect your copies",
    ],
  },
  {
    title: "Save deliberately",
    description:
      "Deck edits remain unsaved until you use Save. The editor marks pending changes so you can experiment, undo, or create a local checkpoint before committing a version.",
    icon: Save,
    tips: [
      "Cmd/Ctrl+S saves the deck",
      "Local checkpoints let you restore an earlier working state",
      "Copy exact printings when exporting to preserve set, collector number, and foil",
    ],
  },
  {
    title: "Review and refine",
    description:
      "Deck Analysis brings legality, roles, goals, mana, collection coverage, budget, tokens, combos, and replacements together. Every section can be collapsed when you want a quieter workspace.",
    icon: BarChart3,
    tips: [
      "Hover cards to inspect them in Preview",
      "Set your preferred budget price provider",
      "Build and save sideboard plans for common matchups",
    ],
  },
  {
    title: "Check engine support",
    description:
      "Validation checks legality and whether every card is supported by both the Manabrew and Forge engines. Warning markers identify unsupported cards and can be filtered or selected together.",
    icon: ShieldCheck,
    tips: [
      "Collection gaps do not affect online deck legality",
      "Use is:unsupported in the deck filter to find unsupported cards",
    ],
  },
  {
    title: "Work from the keyboard",
    description:
      "Open the command palette with Cmd/Ctrl+Shift+P to find editor actions. Undo, redo, save, search, section navigation, and bulk edits all have shortcuts.",
    icon: Sparkles,
    tips: [
      "Alt+3 jumps to the next editor section",
      "Bulk actions: T tags, F toggles foil, M/S/B moves, Delete removes",
      "Cmd/Ctrl+C and Cmd/Ctrl+V copy and paste cards; - and = adjust quantities",
      "Press ? to see every shortcut and customize them in Preferences",
    ],
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

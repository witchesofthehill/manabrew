import { useEffect, useState } from "react";

import { ChooseFromSelectionModal } from "../ChooseFromSelectionModal";
import { PromptModalChromeContext } from "@/components/game/modals/promptModalChrome.context";
import { useGameStore } from "@/stores/useGameStore";
import type { ChooseFromSelectionInput } from "@/protocol";

// ─── EDIT ME ────────────────────────────────────────────────────────────────
// Hardcoded input for eyeballing the generic ChooseFromSelectionModal. Tweak
// the fields and hot-reload. Options render with mana (`{R}` etc.). Set
// minChoices/maxChoices to exercise single-pick (1/1), multi-select (e.g. 1/2),
// or optional (0/N). Paste a card id (logged to console on mount) into
// `sourceCardId` to see the source-card render. Dev-only.
const PREVIEW_INPUT: ChooseFromSelectionInput = {
  presentation: {
    title: "Choose Mode",
    description: "Choose one or both —",
    text: undefined,
    sourceCardId: "card-34",
  },
  options: [
    "Destroy target artifact",
    "Target creature gets +2/+2 until end of turn",
    "Target creature gets -1/-1 until end of turn",
    "Add {R}{R} to your mana pool",
    "Add {U}{R} to your mana pool",
    "Add {G}{G} to your mana pool",
  ],
  minChoices: 1,
  maxChoices: 2,
};
// ─────────────────────────────────────────────────────────────────────────────

export function ChooseFromSelectionModalPreview() {
  const gameView = useGameStore((s) => s.gameView);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!gameView) return;
    const cards = [
      ...gameView.battlefield,
      ...gameView.players.flatMap((p) => [...p.hand, ...p.graveyard, ...p.exile, ...p.commandZone]),
    ];
    console.log(
      "[ChooseFromSelectionModalPreview] card ids for sourceCardId →",
      cards.map((c) => ({ id: c.id, name: c.name })),
    );
  }, [gameView]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-2 left-2 z-[9999] rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
      >
        {open ? "Hide" : "Show"} selection preview
      </button>
      {open && (
        <PromptModalChromeContext.Provider
          value={{ showMinimize: true, onMinimize: () => setOpen(false) }}
        >
          <ChooseFromSelectionModal
            input={PREVIEW_INPUT}
            respond={(o) => console.log("[ChooseFromSelectionModalPreview] respond →", o)}
          />
        </PromptModalChromeContext.Provider>
      )}
    </>
  );
}

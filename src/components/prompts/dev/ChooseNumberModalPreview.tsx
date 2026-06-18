import { useState } from "react";

import { ChooseNumberModal } from "../ChooseNumberModal";
import { PromptModalChromeContext } from "@/components/game/modals/promptModalChrome.context";
import { useGameStore } from "@/stores/useGameStore";
import type { ChooseNumberInput } from "@/protocol";

// ─── EDIT ME ────────────────────────────────────────────────────────────────
// Hardcoded input for eyeballing the generic ChooseNumberModal. Tweak fields
// and hot-reload. The presentation title/description/text render mana symbols
// (`{2}` etc.) — this is how replicate/multikicker/assist costs will display
// once they collapse onto choose_number. A range of ≤20 shows the button grid;
// widen min/max to exercise the text-input fallback. `sourceCardId` is filled
// in below with a real card from the live game state. Dev-only.
const PREVIEW_INPUT: ChooseNumberInput = {
  presentation: {
    title: "Replicate",
    description: "Choose how many times to copy this spell.",
    text: "Pay {2} for each replicate.",
    targets: [],
  },
  min: 4,
  max: 12,
};
// ─────────────────────────────────────────────────────────────────────────────

export function ChooseNumberModalPreview() {
  const gameView = useGameStore((s) => s.gameView);
  const [open, setOpen] = useState(true);

  const sourceCardId = gameView
    ? (gameView.battlefield[0]?.id ??
      gameView.players.flatMap((p) => p.hand)[0]?.id ??
      gameView.players.flatMap((p) => [...p.graveyard, ...p.exile, ...p.commandZone])[0]?.id)
    : undefined;

  const input: ChooseNumberInput = {
    ...PREVIEW_INPUT,
    presentation: { ...PREVIEW_INPUT.presentation, sourceCardId },
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-2 left-2 z-[9999] rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
      >
        {open ? "Hide" : "Show"} number preview
      </button>
      {open && (
        <PromptModalChromeContext.Provider
          value={{ showMinimize: true, onMinimize: () => setOpen(false) }}
        >
          <ChooseNumberModal
            input={input}
            respond={(o) => console.log("[ChooseNumberModalPreview] respond →", o)}
          />
        </PromptModalChromeContext.Provider>
      )}
    </>
  );
}

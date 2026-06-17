import { useEffect, useState } from "react";

import { ChooseBooleanModal } from "../ChooseBooleanModal";
import { PromptModalChromeContext } from "@/components/game/modals/promptModalChrome.context";
import { useGameStore } from "@/stores/useGameStore";
import type { ChooseBooleanInput } from "@/protocol";

// Hardcoded input for eyeballing the generic ChooseBooleanModal. Tweak the
// fields and hot-reload. Paste a card id (logged to the console on mount, see
// below) into `sourceCardId` to see the source-card render. Dev-only.
const PREVIEW_INPUT: ChooseBooleanInput = {
  presentation: {
    title: "Pay Buyback?",
    description: "Pay additional buyback cost: {3}{G}",
    text: "If paid, this spell returns to your hand instead of going to the graveyard.",
    sourceCardId: "card-34",
  },
  confirmLabel: "Pay Buyback",
  denyLabel: "No",
};
// ─────────────────────────────────────────────────────────────────────────────

// Kicker   =>
// Buyback  =>
// Prompt   => choose_boolean
//               ==> modal rendering
//               ==> in view rendering
//

export function ChooseBooleanModalPreview() {
  const gameView = useGameStore((s) => s.gameView);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!gameView) return;
    const cards = [
      ...gameView.battlefield,
      ...gameView.players.flatMap((p) => [...p.hand, ...p.graveyard, ...p.exile, ...p.commandZone]),
    ];
    console.log(
      "[ChooseBooleanModalPreview] card ids for sourceCardId →",
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
        {open ? "Hide" : "Show"} bool preview
      </button>
      {open && (
        <PromptModalChromeContext.Provider
          value={{ showMinimize: true, onMinimize: () => setOpen(false) }}
        >
          <ChooseBooleanModal
            input={PREVIEW_INPUT}
            respond={(o) => console.log("[ChooseBooleanModalPreview] respond →", o)}
          />
        </PromptModalChromeContext.Provider>
      )}
    </>
  );
}

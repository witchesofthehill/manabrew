import { useMemo, useState } from "react";

import { ChooseCardsModal } from "../ChooseCardsModal";
import { PromptModalChromeContext } from "@/components/game/modals/promptModalChrome.context";
import { useGameStore } from "@/stores/useGameStore";
import type { GameCard } from "@/types/manabrew";
import type { ChooseCardsInput } from "@/protocol";

// ─── EDIT ME ──────────────────────────────────────────────────────────────
// Set otherLabel to undefined to see the plain multiselect mode.
const INPUT: Omit<ChooseCardsInput, "cards"> = {
  presentation: { title: "Scry 4", description: "Send cards to the bottom of your library.", targets: [] },
  min: 0,
  max: 4,
  targetLabel: "Bottom of Library",
  otherLabel: "Stays on Top",
};
// const INPUT: Omit<ChooseCardsInput, "cards"> = {
//   presentation: { title: "Discard", description: "Send cards to the bottom of your library.", targets: [] },
//   min: 1,
//   max: 1,
//   targetLabel: "Send to graveyard",
//   // otherLabel: "Stays on Top",
// };
const CARD_COUNT = 8;
// ────────────────────────────────────────────────────────────────────────────

export function ChooseCardsModalPreview() {
  const gameView = useGameStore((s) => s.gameView);
  const [show, setShow] = useState(true);
  const cards = useMemo(() => {
    if (!gameView) return [] as GameCard[];
    const pool = [
      ...gameView.battlefield,
      ...gameView.players.flatMap((p) => [...p.hand, ...p.graveyard]),
    ];
    return pool.slice(0, CARD_COUNT) as GameCard[];
  }, [gameView]);

  return (
    <>
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="fixed bottom-2 left-2 z-[9999] rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
      >
        {show ? "Hide" : "Show"} choose-cards preview
      </button>
      {show && (
        <PromptModalChromeContext.Provider value={{ showMinimize: true, onMinimize: () => setShow(false) }}>
          <ChooseCardsModal
            input={{ ...INPUT, cards: cards as unknown as ChooseCardsInput["cards"] }}
            respond={(o) => console.log("[ChooseCardsModalPreview] respond →", o)}
          />
        </PromptModalChromeContext.Provider>
      )}
    </>
  );
}

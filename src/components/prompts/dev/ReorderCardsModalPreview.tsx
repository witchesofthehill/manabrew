import { useMemo, useState } from "react";

import { ReorderCardsModal } from "../ReorderCardsModal";
import { PromptModalChromeContext } from "@/components/game/modals/promptModalChrome.context";
import { useGameStore } from "@/stores/useGameStore";
import type { GameCard } from "@/types/manabrew";
import type { ReorderCardsInput } from "@/protocol";

// ─── EDIT ME ──────────────────────────────────────────────────────────────
const INPUT: Omit<ReorderCardsInput, "cards"> = {
  presentation: {
    title: "Reorder — Top of Library",
    description: "Drag the cards into the order you want.",
    targets: [],
  },
  targetLabel: "Top of Library",
  topOfDeck: true,
};
const CARD_COUNT = 4;
// ────────────────────────────────────────────────────────────────────────────

export function ReorderCardsModalPreview() {
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
        {show ? "Hide" : "Show"} reorder preview
      </button>
      {show && (
        <PromptModalChromeContext.Provider value={{ showMinimize: true, onMinimize: () => setShow(false) }}>
          <ReorderCardsModal
            input={{ ...INPUT, cards: cards as unknown as ReorderCardsInput["cards"] }}
            respond={(o) => console.log("[ReorderCardsModalPreview] respond →", o)}
          />
        </PromptModalChromeContext.Provider>
      )}
    </>
  );
}

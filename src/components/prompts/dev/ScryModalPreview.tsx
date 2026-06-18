import { useMemo, useState } from "react";

import { ScryModal } from "../ScryModal";
import { PromptModalChromeContext } from "@/components/game/modals/promptModalChrome.context";
import { useGameStore } from "@/stores/useGameStore";
import type { GameCard } from "@/types/manabrew";
import type { ScryInput } from "@/protocol";

// ─── EDIT ME ──────────────────────────────────────────────────────────────
const INPUT: Omit<ScryInput, "cards"> = {
  presentation: {
    title: "Scry 4",
    description: "Put any number on the bottom, the rest on top in any order.",
    targets: [],
  },
  zones: ["libraryTop"],
};
const CARD_COUNT = 4;
// ────────────────────────────────────────────────────────────────────────────

export function ScryModalPreview() {
  const gameView = useGameStore((s) => s.gameView);
  const [show, setShow] = useState(true);
  const { cards, sourceCardId } = useMemo(() => {
    if (!gameView) return { cards: [] as GameCard[], sourceCardId: undefined as string | undefined };
    const pool = [
      ...gameView.battlefield,
      ...gameView.players.flatMap((p) => [...p.hand, ...p.graveyard]),
    ] as GameCard[];
    return {
      cards: pool.slice(0, CARD_COUNT),
      // a card beyond the scry set (fallback to the first) as the "trigger"
      sourceCardId: pool[CARD_COUNT]?.id ?? pool[0]?.id,
    };
  }, [gameView]);

  return (
    <>
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="fixed bottom-2 left-2 z-[9999] rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
      >
        {show ? "Hide" : "Show"} scry preview
      </button>
      {show && (
        <PromptModalChromeContext.Provider value={{ showMinimize: true, onMinimize: () => setShow(false) }}>
          <ScryModal
            input={{
              ...INPUT,
              presentation: { ...INPUT.presentation, sourceCardId },
              cards: cards as unknown as ScryInput["cards"],
            }}
            respond={(o) => console.log("[ScryModalPreview] respond →", o)}
          />
        </PromptModalChromeContext.Provider>
      )}
    </>
  );
}

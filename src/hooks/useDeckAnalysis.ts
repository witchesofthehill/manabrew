import { useEffect, useMemo } from "react";
import { useDeckStore } from "@/stores/useDeckStore";
import { deckAnalysisSignature, useDeckAnalysisStore } from "@/stores/useDeckAnalysisStore";
import { looksLikeCommanderDeck } from "@/lib/formats";

const ANALYSIS_DEBOUNCE_MS = 700;

/** Drives Commander Spellbook combo lookup + bracket estimation for the deck
 *  being edited. Mount once in the deck builder; panels and card cells read the
 *  results from `useDeckAnalysisStore`. */
export function useDeckAnalysis(): void {
  const currentDeck = useDeckStore((s) => s.currentDeck);
  const analyze = useDeckAnalysisStore((s) => s.analyze);
  const reset = useDeckAnalysisStore((s) => s.reset);

  const enabled = looksLikeCommanderDeck(currentDeck);
  const signature = useMemo(() => deckAnalysisSignature(currentDeck), [currentDeck]);

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }
    const handle = setTimeout(
      () => analyze(useDeckStore.getState().currentDeck),
      ANALYSIS_DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [enabled, signature, analyze, reset]);
}

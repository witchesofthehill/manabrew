import { useState } from "react";
import type { CardDto } from "@/protocol/game";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { gameCardFaceIndex } from "@/lib/gameCard";

export interface CardInspectionState {
  rules: boolean;
  face: 0 | 1;
  rotated: boolean;
}

export function useCardInspection() {
  const defaultStyle = usePreferencesStore((s) => s.promptCardStyle);
  const [states, setStates] = useState<Record<string, CardInspectionState>>({});
  const stateFor = (card: CardDto, key = card.id): CardInspectionState =>
    states[key] ?? {
      rules: defaultStyle === "rules",
      face: gameCardFaceIndex(card),
      rotated: false,
    };
  const change = (key: string, state: CardInspectionState) =>
    setStates((previous) => ({ ...previous, [key]: state }));
  return { stateFor, change };
}

import { create } from "zustand";
import type { CardFoilMode } from "@/lib/cardFinish";

interface CardFinishPreview {
  mode: CardFoilMode | null;
  foilAll: boolean;
  setMode: (mode: CardFoilMode) => void;
  setFoilAll: (foilAll: boolean) => void;
  reset: () => void;
}

export const useCardFinishPreview = create<CardFinishPreview>((set) => ({
  mode: null,
  foilAll: false,
  setMode: (mode) => set({ mode }),
  setFoilAll: (foilAll) => set({ foilAll }),
  reset: () => set({ mode: null, foilAll: false }),
}));

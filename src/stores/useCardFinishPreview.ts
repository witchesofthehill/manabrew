import { create } from "zustand";
import type { CardFinish } from "@/protocol/deck";

interface CardFinishPreview {
  mode: CardFinish | null;
  foilAll: boolean;
  setMode: (mode: CardFinish) => void;
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

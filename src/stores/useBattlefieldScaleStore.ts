import { create } from "zustand";

interface BattlefieldScaleState {
  usableHeights: Record<string, number>;
  reportUsableHeight: (boardId: string, height: number) => void;
  clearBoard: (boardId: string) => void;
}

export const useBattlefieldScaleStore = create<BattlefieldScaleState>((set) => ({
  usableHeights: {},
  reportUsableHeight: (boardId, height) =>
    set((state) =>
      state.usableHeights[boardId] === height
        ? state
        : { usableHeights: { ...state.usableHeights, [boardId]: height } },
    ),
  clearBoard: (boardId) =>
    set((state) => {
      if (!(boardId in state.usableHeights)) return state;
      const next = { ...state.usableHeights };
      delete next[boardId];
      return { usableHeights: next };
    }),
}));

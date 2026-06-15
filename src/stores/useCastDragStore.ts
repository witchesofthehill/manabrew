import { create } from "zustand";

interface CastDragState {
  active: boolean;
  setActive: (active: boolean) => void;
}

export const useCastDragStore = create<CastDragState>((set) => ({
  active: false,
  setActive: (active) => set((state) => (state.active === active ? state : { active })),
}));

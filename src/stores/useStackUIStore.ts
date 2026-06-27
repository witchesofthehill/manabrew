import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface StackUIState {
  hoveredStackObjectId: string | null;
  setHoveredStackObjectId: (id: string | null) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  reset: () => void;
}

export const useStackUIStore = create<StackUIState>()(
  devtools(
    (set) => ({
      hoveredStackObjectId: null,
      setHoveredStackObjectId: (id) => set({ hoveredStackObjectId: id }),
      collapsed: false,
      setCollapsed: (collapsed) => set({ collapsed }),
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
      reset: () => set({ hoveredStackObjectId: null, collapsed: false }),
    }),
    { name: "stackUI", enabled: import.meta.env.DEV },
  ),
);

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PromptType } from "@/protocol";

export interface PromptPreferencesState {
  show: Partial<Record<PromptType, boolean>>;
  triggerMemory: Record<string, "yes" | "no">;

  setShow: (promptType: PromptType, show: boolean) => void;
  clearShow: (promptType: PromptType) => void;
  rememberTrigger: (sourceCardId: string, answer: "yes" | "no") => void;
  forgetTrigger: (sourceCardId: string) => void;
  resetForNewGame: () => void;
}

export const usePromptPreferencesStore = create<PromptPreferencesState>()(
  persist(
    (set) => ({
      show: {},
      triggerMemory: {},
      setShow: (promptType, show) => set((s) => ({ show: { ...s.show, [promptType]: show } })),
      clearShow: (promptType) =>
        set((s) => {
          const next = { ...s.show };
          delete next[promptType];
          return { show: next };
        }),
      rememberTrigger: (sourceCardId, answer) =>
        set((s) => ({ triggerMemory: { ...s.triggerMemory, [sourceCardId]: answer } })),
      forgetTrigger: (sourceCardId) =>
        set((s) => {
          const next = { ...s.triggerMemory };
          delete next[sourceCardId];
          return { triggerMemory: next };
        }),
      resetForNewGame: () => set({ triggerMemory: {} }),
    }),
    {
      name: "manabrew.promptPreferences",
      partialize: (s) => ({ show: s.show }),
    },
  ),
);

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PromptType } from "@/protocol";

export interface PromptPreferencesState {
  show: Partial<Record<PromptType, boolean>>;
  fullControl: boolean;
  confirmUnspentMana: boolean;
  confirmRiskyActions: boolean;

  setShow: (promptType: PromptType, show: boolean) => void;
  clearShow: (promptType: PromptType) => void;
  setFullControl: (fullControl: boolean) => void;
  setConfirmUnspentMana: (confirm: boolean) => void;
  setConfirmRiskyActions: (confirm: boolean) => void;
}

export const usePromptPreferencesStore = create<PromptPreferencesState>()(
  persist(
    (set) => ({
      show: {},
      fullControl: false,
      confirmUnspentMana: true,
      confirmRiskyActions: false,
      setShow: (promptType, show) => set((s) => ({ show: { ...s.show, [promptType]: show } })),
      clearShow: (promptType) =>
        set((s) => {
          const next = { ...s.show };
          delete next[promptType];
          return { show: next };
        }),
      setFullControl: (fullControl) => set({ fullControl }),
      setConfirmUnspentMana: (confirmUnspentMana) => set({ confirmUnspentMana }),
      setConfirmRiskyActions: (confirmRiskyActions) => set({ confirmRiskyActions }),
    }),
    {
      name: "manabrew.promptPreferences",
      partialize: (s) => ({
        show: s.show,
        fullControl: s.fullControl,
        confirmUnspentMana: s.confirmUnspentMana,
        confirmRiskyActions: s.confirmRiskyActions,
      }),
    },
  ),
);

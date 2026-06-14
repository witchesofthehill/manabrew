import { create } from "zustand";
import { persist } from "zustand/middleware";
import { STORAGE_KEYS } from "@/lib/constants";
import { KEYBINDINGS, type KeyCombo } from "@/lib/keybindings";

interface KeybindingsState {
  overrides: Record<string, KeyCombo>;
  setBinding: (id: string, combo: KeyCombo) => void;
  resetBinding: (id: string) => void;
  resetAll: () => void;
}

export const useKeybindingsStore = create<KeybindingsState>()(
  persist(
    (set) => ({
      overrides: {},
      setBinding: (id, combo) => set((s) => ({ overrides: { ...s.overrides, [id]: combo } })),
      resetBinding: (id) =>
        set((s) => {
          const next = { ...s.overrides };
          delete next[id];
          return { overrides: next };
        }),
      resetAll: () => set({ overrides: {} }),
    }),
    { name: STORAGE_KEYS.KEYBINDINGS },
  ),
);

export function resolveCombo(id: string, overrides: Record<string, KeyCombo>): KeyCombo | null {
  const override = overrides[id];
  if (override) return override;
  return KEYBINDINGS.find((b) => b.id === id)?.defaultCombo ?? null;
}

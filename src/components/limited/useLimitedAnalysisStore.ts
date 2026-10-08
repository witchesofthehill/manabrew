import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LimitedRole = "creature" | "interaction" | "fixing";
export type LimitedRoleOverride = Partial<Record<LimitedRole, boolean>>;
export type LimitedRoleOverrides = Record<string, LimitedRoleOverride>;

interface LimitedAnalysisStore {
  overrides: Record<string, LimitedRoleOverrides>;
  setRole: (sessionKey: string, cardId: string, role: LimitedRole, value: boolean) => void;
  resetCard: (sessionKey: string, cardId: string) => void;
}

export const useLimitedAnalysisStore = create<LimitedAnalysisStore>()(
  persist(
    (set) => ({
      overrides: {},
      setRole: (sessionKey, cardId, role, value) =>
        set((state) => ({
          overrides: {
            ...state.overrides,
            [sessionKey]: {
              ...state.overrides[sessionKey],
              [cardId]: { ...state.overrides[sessionKey]?.[cardId], [role]: value },
            },
          },
        })),
      resetCard: (sessionKey, cardId) =>
        set((state) => {
          const cards = { ...state.overrides[sessionKey] };
          delete cards[cardId];
          return { overrides: { ...state.overrides, [sessionKey]: cards } };
        }),
    }),
    { name: "manabrew-limited-analysis", version: 1 },
  ),
);

export const EMPTY_ROLE_OVERRIDES: LimitedRoleOverrides = {};

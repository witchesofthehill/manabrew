import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { limitedStateStorage, LIMITED_STORE_NAMES } from "@/game/limitedStorage";
interface OpeningSession {
  openedIds: string[];
  completed: boolean;
}
interface LimitedOpeningState {
  sessions: Record<string, OpeningSession>;
  open: (sessionKey: string, packIds: string[], completed?: boolean) => void;
}
export const useLimitedOpeningStore = create<LimitedOpeningState>()(
  persist(
    (set) => ({
      sessions: {},
      open: (sessionKey, packIds, completed = false) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionKey]: {
              openedIds: [
                ...new Set([...(state.sessions[sessionKey]?.openedIds ?? []), ...packIds]),
              ],
              completed: completed || (state.sessions[sessionKey]?.completed ?? false),
            },
          },
        })),
    }),
    {
      name: LIMITED_STORE_NAMES.opening,
      version: 1,
      storage: createJSONStorage(() => limitedStateStorage),
    },
  ),
);

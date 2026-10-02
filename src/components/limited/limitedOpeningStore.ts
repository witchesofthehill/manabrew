import { create } from "zustand";
import { persist } from "zustand/middleware";
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
    { name: "manabrew-limited-openings", version: 1 },
  ),
);

import { create } from "zustand";
import type { DraftClockSnapshot } from "@/game/limitedDraftClock";

interface LimitedDraftClockStore {
  sessions: Record<string, DraftClockSnapshot>;
  setClock: (clock: DraftClockSnapshot) => void;
  clearClock: (sessionId: string) => void;
}

export const useLimitedDraftClockStore = create<LimitedDraftClockStore>((set) => ({
  sessions: {},
  setClock: (clock) =>
    set((state) => ({ sessions: { ...state.sessions, [clock.sessionId]: clock } })),
  clearClock: (sessionId) =>
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[sessionId];
      return { sessions };
    }),
}));

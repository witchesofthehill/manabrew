import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { DraftCard } from "@/types/limited";

export type MpSealedMode = "idle" | "building" | "complete";

interface MpSealedState {
  mode: MpSealedMode;
  roomId: string | null;
  setCode: string;
  pool: DraftCard[];
  sessionId: string | null;
  lastError: string | null;

  enter: (args: { roomId: string; setCode: string; pool: DraftCard[]; sessionId: string }) => void;
  complete: () => void;
  setError: (msg: string | null) => void;
  clear: () => void;
}

export const useMultiplayerSealedStore = create<MpSealedState>()(
  devtools(
    (set) => ({
      mode: "idle",
      roomId: null,
      setCode: "",
      pool: [],
      sessionId: null,
      lastError: null,

      enter: ({ roomId, setCode, pool, sessionId }) =>
        set({
          mode: "building",
          roomId,
          setCode,
          pool,
          sessionId,
          lastError: null,
        }),
      complete: () => set({ mode: "complete", lastError: null }),
      setError: (msg) => set({ lastError: msg }),
      clear: () =>
        set({
          mode: "idle",
          roomId: null,
          setCode: "",
          pool: [],
          sessionId: null,
          lastError: null,
        }),
    }),
    { name: "mp-sealed", enabled: import.meta.env.DEV },
  ),
);

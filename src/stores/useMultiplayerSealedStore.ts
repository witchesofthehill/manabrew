import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { DraftCard } from "@/types/limited";

export type MpSealedMode = "idle" | "building" | "complete";

interface MpSealedState {
  mode: MpSealedMode;
  /** Room the sealed phase belongs to. Cleared on exit so a re-enter
   *  routes through the room's current `sealed_config`. */
  roomId: string | null;
  /** Set code (or future cube id) the host baked into the room. */
  setCode: string;
  /** Cards the local player opens. Independent per peer — each
   *  client calls `limited_start_sealed` with its own seat-derived
   *  seed, so two players never see the same pool. */
  pool: DraftCard[];
  /** Engine session id returned by `limited_start_sealed`. Useful
   *  for the deck-builder's "save back to engine" flow if we ever
   *  wire one (we don't yet — saving lands in My Decks). */
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

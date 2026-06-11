import { create } from "zustand";
import { devtools } from "zustand/middleware";

import type { MpDraftConfig, MpDraftSeatAssignment } from "@/game/draftRelay";
import type { DraftCard, DraftState } from "@/types/limited";

export type MpDraftMode = "idle" | "drafting" | "complete";

export interface MpDraftPlayerPool {
  seat: number;
  displayName: string;
  isHuman: boolean;
  playerSlot: string | null;
  pool: DraftCard[];
}

interface MultiplayerDraftStore {
  mode: MpDraftMode;
  amHost: boolean;
  sessionId: string | null;
  roomId: string | null;
  config: MpDraftConfig | null;
  seats: MpDraftSeatAssignment[];
  mySeat: number | null;
  state: DraftState | null;
  finalPools: MpDraftPlayerPool[];
  lastError: string | null;
  pickPending: boolean;

  enterAsHost: (args: {
    sessionId: string;
    roomId: string;
    config: MpDraftConfig;
    seats: MpDraftSeatAssignment[];
    mySeat: number;
    state: DraftState;
  }) => void;
  enterAsPeer: (args: {
    sessionId: string;
    roomId: string;
    config: MpDraftConfig;
    seats: MpDraftSeatAssignment[];
    mySeat: number;
    state: DraftState;
  }) => void;
  setLocalState: (state: DraftState) => void;
  setPickPending: (pending: boolean) => void;
  complete: (pools: MpDraftPlayerPool[]) => void;
  setError: (msg: string | null) => void;
  clear: () => void;
}

export const useMultiplayerDraftStore = create<MultiplayerDraftStore>()(
  devtools(
    (set) => ({
      mode: "idle",
      amHost: false,
      sessionId: null,
      roomId: null,
      config: null,
      seats: [],
      mySeat: null,
      state: null,
      finalPools: [],
      lastError: null,
      pickPending: false,

      enterAsHost: ({ sessionId, roomId, config, seats, mySeat, state }) => {
        set({
          mode: "drafting",
          amHost: true,
          sessionId,
          roomId,
          config,
          seats,
          mySeat,
          state,
          finalPools: [],
          lastError: null,
          pickPending: false,
        });
      },
      enterAsPeer: ({ sessionId, roomId, config, seats, mySeat, state }) => {
        set({
          mode: "drafting",
          amHost: false,
          sessionId,
          roomId,
          config,
          seats,
          mySeat,
          state,
          finalPools: [],
          lastError: null,
          pickPending: false,
        });
      },
      setLocalState: (state) => set({ state, pickPending: false }),
      setPickPending: (pickPending) => set({ pickPending }),
      complete: (pools) =>
        set({ mode: "complete", finalPools: pools, lastError: null, pickPending: false }),
      setError: (msg) => set({ lastError: msg }),
      clear: () =>
        set({
          mode: "idle",
          amHost: false,
          sessionId: null,
          roomId: null,
          config: null,
          seats: [],
          mySeat: null,
          state: null,
          finalPools: [],
          lastError: null,
          pickPending: false,
        }),
    }),
    { name: "multiplayerDraft", enabled: import.meta.env.DEV },
  ),
);

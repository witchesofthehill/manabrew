import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

import type { MpDraftConfig, MpDraftSeatAssignment } from "@/game/draftRelay";
import type { DraftState } from "@/types/limited";

export type MpDraftMode = "idle" | "drafting" | "complete";

interface MultiplayerDraftStore {
  mode: MpDraftMode;
  amHost: boolean;
  sessionId: string | null;
  roomId: string | null;
  config: MpDraftConfig | null;
  seats: MpDraftSeatAssignment[];
  mySeat: number | null;
  state: DraftState | null;
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
  complete: () => void;
  setError: (msg: string | null) => void;
  clear: () => void;
}

export const useMultiplayerDraftStore = create<MultiplayerDraftStore>()(
  devtools(
    persist(
      (set) => ({
        mode: "idle",
        amHost: false,
        sessionId: null,
        roomId: null,
        config: null,
        seats: [],
        mySeat: null,
        state: null,
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
            lastError: null,
            pickPending: false,
          });
        },
        setLocalState: (state) => set({ state, pickPending: false }),
        setPickPending: (pickPending) => set({ pickPending }),
        complete: () => set({ mode: "complete", lastError: null, pickPending: false }),
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
            lastError: null,
            pickPending: false,
          }),
      }),
      { name: "manabrew-multiplayer-draft" },
    ),
    { name: "multiplayerDraft", enabled: import.meta.env.DEV },
  ),
);

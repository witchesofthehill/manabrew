import { create } from "zustand";
import { devtools } from "zustand/middleware";

import type { MpDraftConfig, MpDraftSeatAssignment } from "@/game/draftRelay";
import type { DraftCard, DraftState } from "@/types/limited";

/**
 * Per-player state for an in-progress multiplayer draft. Both the host
 * and the peers read from this store; the host additionally drives the
 * engine session via `draftHost.ts`. `mode` discriminates the local
 * lifecycle, not the engine's — the engine session lives on the host
 * regardless of which peer is reading this store.
 */
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
  /** Engine session id (only meaningful on the host; peers carry it
   *  through so picks can be addressed to the same draft). */
  sessionId: string | null;
  /** Room this draft belongs to — used to scope relay envelopes. */
  roomId: string | null;
  config: MpDraftConfig | null;
  seats: MpDraftSeatAssignment[];
  /** Seat index this local client is sitting at. `null` if the local
   *  client is observing only (e.g. observer join, future feature). */
  mySeat: number | null;
  /** Local player's view of the draft state (their pack + picked pile +
   *  seat summaries). Updated by relay broadcasts on peers, by direct
   *  engine reads on the host. */
  state: DraftState | null;
  /** Final pools, populated when the draft completes. Empty array
   *  until `mode === "complete"`. */
  finalPools: MpDraftPlayerPool[];
  /** Surfaces "engine threw" or "host disconnected mid-draft" — UI
   *  renders this in a banner. */
  lastError: string | null;

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
        });
      },
      setLocalState: (state) => set({ state }),
      complete: (pools) => set({ mode: "complete", finalPools: pools, lastError: null }),
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
        }),
    }),
    { name: "multiplayerDraft", enabled: import.meta.env.DEV },
  ),
);

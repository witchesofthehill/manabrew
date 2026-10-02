import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MpDraftSeatAssignment } from "@/game/draftRelay";
import type { DraftCard, SealedPool } from "@/types/limited";
import type { RoomInfo } from "@/types/server";

export interface LimitedBuild {
  main: DraftCard[];
  sideboard: DraftCard[];
}
export interface LimitedSeatStatus {
  seat: number;
  ready: boolean;
  opened: boolean;
  playing?: boolean;
}
export interface LimitedSeries {
  seats: number[];
  wins: number[];
  complete: boolean;
}
export interface LimitedMatchReturn {
  roomId: string;
  host: string;
  route: string;
  sessionId: string;
  result?: { gameId: string; winner: string | null };
  started?: boolean;
}
interface MultiplayerLimitedState {
  kind: "draft" | "sealed" | null;
  phase: "idle" | "opening" | "building" | "playing";
  sessionId: string | null;
  originalRoom: RoomInfo | null;
  seats: MpDraftSeatAssignment[];
  mySeat: number | null;
  pool: DraftCard[];
  sealed: SealedPool | null;
  build: LimitedBuild | null;
  statuses: LimitedSeatStatus[];
  bestOf: 1 | 3;
  series: LimitedSeries[];
  matchReturn: LimitedMatchReturn | null;
  lastError: string | null;
  enter: (args: {
    kind: "draft" | "sealed";
    sessionId: string;
    originalRoom: RoomInfo;
    seats: MpDraftSeatAssignment[];
    mySeat: number;
    pool: DraftCard[];
    sealed?: SealedPool | null;
    build?: LimitedBuild | null;
    statuses: LimitedSeatStatus[];
    bestOf: 1 | 3;
    series: LimitedSeries[];
  }) => void;
  setBuild: (build: LimitedBuild) => void;
  setStatuses: (statuses: LimitedSeatStatus[]) => void;
  opened: () => void;
  setError: (message: string | null) => void;
  clear: () => void;
}
const empty = {
  kind: null,
  phase: "idle",
  sessionId: null,
  originalRoom: null,
  seats: [],
  mySeat: null,
  pool: [],
  sealed: null,
  build: null,
  statuses: [],
  bestOf: 1 as 1 | 3,
  series: [] as LimitedSeries[],
  matchReturn: null,
  lastError: null,
} as const;
export const useMultiplayerLimitedStore = create<MultiplayerLimitedState>()(
  persist(
    (set, get) => ({
      ...empty,
      seats: [],
      pool: [],
      statuses: [],
      enter: (args) => {
        const same = get().sessionId === args.sessionId;
        set({
          ...args,
          sealed: args.sealed ?? null,
          build: args.build ?? (same ? get().build : null),
          phase:
            args.kind === "sealed" && !args.statuses.find((s) => s.seat === args.mySeat)?.opened
              ? "opening"
              : "building",
          matchReturn: same ? get().matchReturn : null,
          lastError: null,
        });
      },
      setBuild: (build) =>
        set({
          build,
          statuses: get().statuses.map((s) =>
            s.seat === get().mySeat ? { ...s, ready: false } : s,
          ),
        }),
      setStatuses: (statuses) => set({ statuses }),
      opened: () => set({ phase: "building" }),
      setError: (lastError) => set({ lastError }),
      clear: () => set({ ...empty, seats: [], pool: [], statuses: [] }),
    }),
    { name: "manabrew-multiplayer-limited" },
  ),
);

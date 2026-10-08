import type { BuildSession } from "@/components/limited/useLimitedBuildStore";
import type { MpDraftConfig, MpDraftSeatAssignment } from "@/game/draftRelay";
import type { DraftClockSnapshot } from "@/game/limitedDraftClock";
import type {
  DraftCard,
  DraftState,
  WinstonState,
  SealedPool,
  GauntletState,
  LimitedDraftDecision,
  LimitedEngineCheckpoint,
} from "@/types/limited";
import type { RoomInfo } from "@/types/server";
import type { GauntletProgress, PendingGauntletMatch } from "@/lib/gauntletReturn";
import type { GauntletOutcome } from "@/types/limited";
import type { ResumeRoomParams } from "@/platform/types";

export type LimitedSessionKind = "draft" | "winston" | "sealed" | "gauntlet";
export type LimitedVisibleState = DraftState | WinstonState | SealedPool | GauntletState;
export interface LimitedDraftHostRecovery {
  roomId: string;
  hostSlot: string;
  mySeat: number;
  config: MpDraftConfig;
  seats: MpDraftSeatAssignment[];
  complete: boolean;
}
export interface LimitedConnectionRecovery {
  username: string;
  host: string;
  port: number;
  password: string;
  roomPassword: string | null;
  room: RoomInfo;
  resume: ResumeRoomParams;
}
export interface LimitedSavedSession {
  schemaVersion: 1;
  sessionId: string;
  kind: LimitedSessionKind;
  role: "solo" | "host" | "peer" | "review";
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  complete: boolean;
  state: LimitedVisibleState | null;
  checkpoint: LimitedEngineCheckpoint | null;
  history: LimitedDraftDecision[];
  seat: number;
  sourceSessionId?: string;
  setup?: unknown;
  build?: BuildSession;
  opening?: { openedIds: string[]; completed: boolean };
  clock?: DraftClockSnapshot;
  draftHost?: LimitedDraftHostRecovery;
  draftPeer?: unknown;
  hostSession?: unknown;
  peerSession?: unknown;
  connection?: LimitedConnectionRecovery;
  sealedCheckpoints?: LimitedEngineCheckpoint[];
  acceptedRequests?: string[];
  results?: Array<{ gameId: string; winner: string | null }>;
  reviewCards?: DraftCard[];
  gauntletProgress?: GauntletProgress;
  pendingGauntletMatch?: PendingGauntletMatch | null;
  gauntletOutcome?: GauntletOutcome;
}
export interface LimitedReviewDocument {
  format: "manabrew-limited-review";
  schemaVersion: 1;
  kind: "draft" | "winston" | "sealed";
  title: string;
  exportedAt: string;
  complete: boolean;
  seat: number;
  cards: DraftCard[];
  history: LimitedDraftDecision[];
  build?: BuildSession;
}

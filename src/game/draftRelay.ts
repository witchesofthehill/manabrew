import type { DraftCard, DraftState } from "@/types/limited";
import type { RoomRelayEnvelope } from "@/types/server";

export const DRAFT_RELAY_PROTOCOL = "draft-v1";

export interface MpDraftConfig {
  setCode?: string;
  cubeId?: string;
  cubeName?: string;
  podSize: number;
  rounds: number;
  picksPerPass: number;
  seed?: number;
  fillWithBots: boolean;
}

export interface MpDraftSeatAssignment {
  seat: number;
  playerSlot: string | null;
  displayName: string;
  isHuman: boolean;
}

export interface DraftStartMessage {
  type: "start";
  sessionId: string;
  config: MpDraftConfig;
  seats: MpDraftSeatAssignment[];
}

export interface DraftStateBroadcastMessage {
  type: "stateUpdate";
  sessionId: string;
  seat: number;
  state: DraftState;
}

export interface DraftPickMessage {
  type: "pick";
  sessionId: string;
  cardName: string;
  round?: number;
  pickNumber?: number;
}

export interface DraftCompleteMessage {
  type: "complete";
  sessionId: string;
  picks: Array<{
    seat: number;
    playerSlot: string | null;
    displayName: string;
    isHuman: boolean;
    pool: DraftCard[];
  }>;
}

export type DraftRelayPayload =
  | DraftStartMessage
  | DraftStateBroadcastMessage
  | DraftPickMessage
  | DraftCompleteMessage;

export type DraftRelayEnvelope = RoomRelayEnvelope<DraftRelayPayload>;

export function isDraftRelay(env: RoomRelayEnvelope): env is DraftRelayEnvelope {
  return env.protocol === DRAFT_RELAY_PROTOCOL;
}

export function makeDraftRelay(
  payload: DraftRelayPayload,
  opts: {
    fromPlayer?: string;
    targetPlayer?: string;
    roomId?: string;
    messageId?: string;
  } = {},
): DraftRelayEnvelope {
  return {
    kind: "roomRelay",
    protocol: DRAFT_RELAY_PROTOCOL,
    version: 1,
    messageId: opts.messageId ?? crypto.randomUUID(),
    fromPlayer: opts.fromPlayer,
    targetPlayer: opts.targetPlayer,
    roomId: opts.roomId,
    payload,
  };
}

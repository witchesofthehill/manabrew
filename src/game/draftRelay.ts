// SPDX-License-Identifier: GPL-3.0-or-later
//
// Multiplayer booster-draft relay protocol. Lives entirely in the client
// — the matchmaking server is a dumb relay; one client (the room host)
// owns the actual `BoosterDraft` engine session and broadcasts each
// peer's per-seat view via `RoomRelayEnvelope`. Peers send their picks
// back to the host through the same envelope.
//
// Wire field naming intentionally matches the engine DTOs so the same
// payload shapes round-trip through `limited_start_multiplayer_draft`,
// `limited_submit_pick`, `limited_get_seat_state` without translation.

import type { DraftCard, DraftState } from "@/types/limited";
import type { RoomRelayEnvelope } from "@/types/server";

/** Protocol identifier carried in `RoomRelayEnvelope.protocol`. Bumping
 *  the version is a clean way to gate clients during rollout — peers on
 *  an older version see an unknown protocol and skip the payload. */
export const DRAFT_RELAY_PROTOCOL = "draft-v1";

/** Configuration baked into a draft room. The pool itself is resolved
 *  at start time (set-pool via `EditionsRegistry` or cube via
 *  CubeCobra re-fetch) so joining peers don't carry ~250+ card refs. */
export interface MpDraftConfig {
  /** Exactly one of `setCode` or `cubeId` is populated. */
  setCode?: string;
  cubeId?: string;
  /** Display name for the cube — empty for set drafts. */
  cubeName?: string;
  podSize: number;
  rounds: number;
  picksPerPass: number;
  seed?: number;
  /** Empty seats not filled by humans become AI bots. Set to `false`
   *  to block start until exactly `podSize` humans have joined. */
  fillWithBots: boolean;
}

/** Per-seat assignment broadcast by the host at draft start. Peers find
 *  their own seat by matching `playerSlot` against their local server
 *  identity (`player-N`). */
export interface MpDraftSeatAssignment {
  seat: number;
  /** Server-side player slot ("player-N") or `null` for bot seats. */
  playerSlot: string | null;
  displayName: string;
  isHuman: boolean;
}

/** Host → everyone. Signals "draft is starting", carries the seat
 *  layout, and gives each peer the session id to use when posting
 *  picks back. The host's own UI also reads this to enter the draft
 *  view at the same moment. */
export interface DraftStartMessage {
  type: "start";
  sessionId: string;
  config: MpDraftConfig;
  seats: MpDraftSeatAssignment[];
}

/** Host → specific peer. Renders that peer's draft view. Sent on draft
 *  start and after every pick that affects the targeted seat (their
 *  pack changing, AI/peer pick advancing the round, etc.). */
export interface DraftStateBroadcastMessage {
  type: "stateUpdate";
  sessionId: string;
  seat: number;
  state: DraftState;
}

/** Peer → host. Forwarded to the host (set as `targetPlayer` on the
 *  envelope) so they can submit it to the engine. The host derives the
 *  seat index from the envelope's `fromPlayer` against the seat
 *  assignment list it broadcast at start. */
export interface DraftPickMessage {
  type: "pick";
  sessionId: string;
  cardName: string;
}

/** Host → everyone. Draft is over; the broadcast carries each player's
 *  final picked pool so peers can navigate to the build / completion
 *  view without needing another round-trip to the host. */
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

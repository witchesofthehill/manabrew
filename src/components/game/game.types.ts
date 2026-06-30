import type { CardDto } from "@/protocol/game";
import type { GameLogEntry } from "@/types/gameLog";
import type { GameSnapshotEntry } from "@/types/gameSnapshot";
import type { PromptType } from "@/protocol";

export type PromptActionType = PromptType;

export interface CombatAssignment {
  blockerId: string;
  attackerId: string;
}

export interface CombatPairing {
  key: string;
  attacker: string;
  defender: string;
  count: number;
}

export type FlashItem =
  | { kind: "card"; cardId: string; cardName: string; setCode: string }
  | { kind: "turn"; playerId: string; playerName: string };

/** Seat identifier used to resolve per-player theme colours. Source of
 *  truth for `playerColors.<seat>` theme keys and for `OPPONENT_SEATS`
 *  index → seat mapping. */
export type PlayerSeat = "self" | "opponent1" | "opponent2" | "opponent3";

/** Ordered list of opponent seats, indexed by `opponentIndex`. Keep in
 *  sync with `PlayerSeat` — TS will fail compilation if they diverge. */
export const OPPONENT_SEATS: readonly Exclude<PlayerSeat, "self">[] = [
  "opponent1",
  "opponent2",
  "opponent3",
] as const;

export interface RightActionPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  gameLog: GameLogEntry[];
  onHoverLogCard: (
    cardId: string | null,
    e?: React.MouseEvent,
    options?: { useAnchor?: boolean; placement?: "auto" | "top-center"; anchorOverride?: DOMRect },
  ) => void;
  resolveCardName: (cardId: string) => string;
  resolvePlayerName: (playerId: string) => string;
  snapshots: GameSnapshotEntry[];
  canRestoreSnapshots: boolean;
  onRestoreSnapshot: (checkpointId: number) => void;
}

export interface MainActionOverlayProps {
  promptType?: PromptActionType;
  isWaitingForResponse: boolean;
  isWaitingForOthers: boolean;
  availableAttackerIds: string[];
  pendingAttackers: string[];
  onPassPriority: () => void;
  selectedAttackDefenderId?: string | null;
  multipleAttackDefenders: boolean;
  attackAssignmentCount: number;
  mustAttackHint?: string | null;
  onDeclareAttackers: (attackerIds: string[], defenderId?: string) => void;
  onBeginAttackTargetPick: (attackerIds: string[]) => void;
  onSubmitAttack: () => void;
  pendingAttacker: string | null;
  pendingBlocker: string | null;
  blockError?: string | null;
  blockRequirementError?: string | null;
  blockRestrictionHint?: string | null;
  attackerIds: string[];
  blockAssignments: CombatAssignment[];
  combatPairings: CombatPairing[];
  onDeclareBlockers: (assignments: CombatAssignment[]) => void;
  damageOrderCount: number;
  damageOrderTotal: number;
  onConfirmDamageOrder: () => void;
  onUndoDamageOrder: () => void;
  onDefaultDamageOrder: () => void;
  onOpenStack: () => void;
  targetCompletionLabel?: string | null;
  onCompleteTargets?: (() => void) | null;
  resolveCardName: (cardId: string) => string;
  resolveCard: (cardId: string) => CardDto | undefined;
  turn: number;
  activePlayerName: string;
  isMyTurn: boolean;
  step: string;
  payManaCostInfo: {
    cardName: string;
    manaCost: string;
    description?: string;
    manaPool: Record<string, number>;
    canConfirmFromPool: boolean;
    delveCount?: number;
    delveAvailable?: boolean;
    onOpenDelve?: () => void;
  } | null;
  onPayManaCost: () => void;
  onAutoManaCost: () => void;
  onCancelManaCost: () => void;
  // Mulligan (live inside the prompt slot with Pass Priority so the
  // player never leaves the board for a keep/mulligan decision).
  mulliganCount?: number;
  onMulliganKeep?: () => void;
  onMulliganDraw?: () => void;
  mulliganPutBackCount?: number;
  mulliganSelectedCount?: number;
  onMulliganPutBackConfirm?: () => void;
  selfClusterMaxHeight?: number;
}

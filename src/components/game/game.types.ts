import type { GameCard, Player, ActivatableAbilityInfo } from "@/types/manabrew";
import type { GameLogEntry } from "@/types/gameLog";
import type { GameSnapshotEntry } from "@/types/gameSnapshot";
import type { PromptType } from "@/protocol";
import type { PixiGameScene } from "@/pixi/PixiGameScene";

export type PromptActionType = PromptType;

export interface CombatAssignment {
  blockerId: string;
  attackerId: string;
}

export type FlashItem =
  | { kind: "card"; cardId: string; cardName: string; setCode: string }
  | { kind: "turn"; playerId: string; playerName: string };

export interface PlacementGhost {
  stackObjectId: string;
  cardName: string;
  controllerId: string;
}

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

export interface OpponentHalfProps {
  player: Player;
  /** 0-based opponent index for seat color assignment. */
  opponentIndex: number;
  permanents: GameCard[];
  graveyard: GameCard[];
  exile: GameCard[];
  commandZone?: GameCard[];
  isTargetable: boolean;
  isSelectedTarget?: boolean;
  onTarget: () => void;
  isFlashing: boolean;
  activePlayerId: string;
  priorityPlayerId: string;
  step: string;
  promptType: PromptType | undefined;
  pendingAttacker: string | null;
  attackerIds?: string[];
  selectableCardIds?: string[];
  onClickCard: (card: GameCard) => void;
  onClickAnyCard: (card: GameCard) => void;
  onHoverCard: (
    card: GameCard | null,
    e?: React.MouseEvent,
    options?: { useAnchor?: boolean; placement?: "auto" | "top-center"; anchorOverride?: DOMRect },
  ) => void;
  onFlipCard: () => void;
  onOpenZone: (title: string, cards: GameCard[], onClickCard?: (cardId: string) => void) => void;
  zonePanelOrder: ("library" | "graveyard" | "exile")[];
  isMonarch?: boolean;
  hasInitiative?: boolean;
  hostileTargeting?: boolean;
  manaAbilityOptions?: ActivatableAbilityInfo[];
  /** Populated by the opponent's Pixi canvas so the full-board arrow
   *  layer can resolve sprite positions for opponent permanents
   *  without round-tripping through DOM queries. */
  pixiSceneRef?: React.MutableRefObject<PixiGameScene | null>;
}

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
  isAutoPassing: boolean;
  isPassingUntilEot: boolean;
  availableAttackerIds: string[];
  pendingAttackers: string[];
  onPassPriority: () => void;
  onPassUntilEot: () => void;
  selectedAttackDefenderId?: string | null;
  selectedAttackDefenderLabel?: string | null;
  multipleAttackDefenders: boolean;
  onDeclareAttackers: (attackerIds: string[], defenderId?: string) => void;
  onBeginAttackTargetPick: (attackerIds: string[]) => void;
  pendingAttacker: string | null;
  attackerIds: string[];
  blockAssignments: CombatAssignment[];
  onDeclareBlockers: (assignments: CombatAssignment[]) => void;
  onOpenStack: () => void;
  onConcede: () => void;
  resolveCardName: (cardId: string) => string;
  resolveCard: (cardId: string) => GameCard | undefined;
  isMyPriority: boolean;
  turn: number;
  activePlayerName: string;
  isMyTurn: boolean;
  step: string;
  payManaCostInfo: {
    cardName: string;
    manaCost: string;
    manaPool: Record<string, number>;
    canConfirmFromPool: boolean;
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
}

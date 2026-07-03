import type { CardDto, CombatAssignmentDto } from "@/protocol/game";
import type { ManaAbilityActionInfo } from "@/components/game/manaUtils";

export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Sub-rectangle of the canvas used for auto-placement + hand layout.
 *  The canvas itself can be larger (covering both halves of the board so
 *  arrows span everything) while gameplay sprites stay inside this rect. */
export type PlayZoneRect = ScreenBounds;

export interface ScreenPos {
  x: number;
  y: number;
}

export type HoverPlacement = "auto" | "top-center";

/**
 * Arrow endpoint referenced by game-entity identity so the Pixi scene can
 * resolve the current position from its own sprite maps (canvas-local), the
 * stack anchor provider (stack cards), or a DOM query (player panels).
 */
export type ArrowEndpoint =
  | { kind: "card"; id: string }
  | { kind: "player"; id: string }
  | { kind: "stack"; id: string }
  /** "Drop here" anchor for the placement preview. `playerId` selects
   *  which player's battlefield the ghost points at — when set, the
   *  resolver looks up that player's board region; when omitted it
   *  falls back to the local player's region. */
  | { kind: "placement-ghost"; playerId?: string }
  | { kind: "zone-tile"; playerId: string; key: string };

/** Arrows render combat declarations (`attack` / `block`, painterly
 *  variant), attach relationships (`attach`, rune variant — Equipment /
 *  Aura targeting), and the placement preview (`placement`, dashed
 *  marching-ants) when casting a permanent spell, and the live targeting
 *  arrow (`casting`, painterly with an explicit intent color). */
export type ArrowType = "attack" | "block" | "attach" | "placement" | "casting";

export interface ArrowSpec {
  from: ArrowEndpoint;
  to: ArrowEndpoint;
  type: ArrowType;
  hostile?: boolean;
}

export interface GameCanvasCallbacks {
  onClickCard?: (card: CardDto) => void;
  onClickAnyCard?: (card: CardDto) => void;
  onHoverCard?: (
    card: CardDto | null,
    screenBounds?: ScreenBounds,
    options?: { useAnchor?: boolean; placement?: HoverPlacement },
  ) => void;
  onFlipCard?: () => void;
  onStartDrag?: (card: CardDto, screenPos: ScreenPos) => void;
  onClickCard_Hand?: (card: CardDto) => void;
  onHoverHandCard?: (card: CardDto | null, screenBounds?: ScreenBounds) => void;
  onTargetPlayer?: (playerId: string) => void;
  /** Fires when a non-targetable player's avatar is tapped — opens their detail sheet. */
  onShowPlayerSheet?: (playerId: string) => void;
  /** Fires when the self panel's gear is tapped — opens the board menu. */
  onShowBoardMenu?: () => void;
  /** Fires when the mouse enters/leaves an opponent's battleground (null off-field). */
  onHoverOpponent?: (playerId: string | null) => void;
  onTapLand?: (card: CardDto) => void;
  onTapLands?: (cardIds: string[]) => void;
  onTapLandAbility?: (actionId: string) => void;
  onUntapLand?: (card: CardDto) => void;
  onUntapLands?: (cardIds: string[]) => void;
  onAttackerClick?: (card: CardDto) => void;
  /** Drag-to-block: a blocker sprite was dropped onto an attacker sprite. */
  onAssignBlock?: (blockerId: string, attackerId: string) => void;
  /** Drag-to-unblock: a staged blocker was dragged back off its attacker. */
  onUnassignBlock?: (blockerId: string) => void;
  /** Fires when a block-drag arms (blockerId) or ends (null), so the UI can
   *  highlight the attackers that blocker may legally block. */
  onBlockDragChange?: (blockerId: string | null) => void;
  /** Drag-to-attack: a creature sprite was dropped onto a defender (player /
   *  planeswalker / battle). */
  onAssignAttacker?: (attackerId: string, targetId: string) => void;
  /** Drag-to-unattack: a staged attacker was dragged back off its target. */
  onUnassignAttacker?: (attackerId: string) => void;
  /** Fires when an attack-drag arms (attackerId) or ends (null), so the UI can
   *  highlight that attacker's legal defenders. */
  onAttackDragChange?: (attackerId: string | null) => void;
  onCastSpell?: (cardId: string) => void;
  /**
   * Dismiss the hover preview immediately (no 250ms grace). Used when
   * the scene begins a drag so the preview doesn't linger on the cursor.
   */
  onDismissHoverPreview?: () => void;
}

export interface BattlefieldState {
  cards: CardDto[];
  pendingCardIds?: string[];
  attackingCardIds?: string[];
  /** Blockers chosen so far in damage-assignment ordering; index+1 is shown as a
   *  numbered badge on each (first in line takes damage first). */
  orderedCardIds?: string[];
  selectableCardIds?: string[];
  mustAttackCardIds?: string[];
  tappableLandIds?: string[];
  untappableLandIds?: string[];
  manaAbilityOptions?: ManaAbilityActionInfo[];
  hostileTargeting?: boolean;
  /** Selectable cards that should glow hostile-red rather than the neutral ring
   *  — planeswalker / battle attack targets during declare-attackers. */
  hostileTargetCardIds?: string[];
  ownerRingByCard?: Record<string, string>;
  combatRowAttackerIds?: string[];
  combatRowBlocks?: CombatAssignmentDto[];
  combatRowGroups?: {
    color: string;
    label: string;
    avatarUrl?: string;
    attackerIds: string[];
  }[];
}

export interface HandState {
  cards: CardDto[];
  playableIds?: Set<string>;
  draggingCardId?: string;
  draggingIsPermanent?: boolean;
  castingCardId?: string | null;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
}

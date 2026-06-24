import type { CardDto } from "@/protocol/game";
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
 * resolve the current position from its own sprite maps (canvas-local) or
 * fall back to DOM query (player panels, stack cards).
 */
export type ArrowEndpoint =
  | { kind: "card"; id: string }
  | { kind: "player"; id: string }
  | { kind: "stack"; id: string }
  /** "Drop here" anchor for the placement preview. `playerId` selects
   *  which player's battlefield the ghost points at — when set, the
   *  resolver looks up that player's board region; when omitted it
   *  falls back to the local player's region. */
  | { kind: "placement-ghost"; playerId?: string };

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
}

/**
 * Cursor-following pointer shown during target selection. Source is a
 * React-rendered element with `data-casting-card={id}` (StackDisplay).
 * Target is either a specific card/player (locked target) or the cursor.
 */
export interface CastingArrowSpec {
  castingCardId: string;
  /** When set, the arrow locks onto this card or player id. */
  targetId?: string | null;
  /** Legacy hostile flag — kept so existing props don't break. */
  hostile: boolean;
  /** Semantic intent used to pick the pointer icon + glow color. */
  intent: import("@/types/promptType").TargetingIntent;
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
  tappableLandIds?: string[];
  untappableLandIds?: string[];
  manaAbilityOptions?: ManaAbilityActionInfo[];
  hostileTargeting?: boolean;
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

export interface CardSpriteData {
  card: CardDto;
  x: number;
  y: number;
  tapped: boolean;
  ringColor: number | null;
  ringAlpha: number;
  phasedOut: boolean;
  summoningSick: boolean;
}

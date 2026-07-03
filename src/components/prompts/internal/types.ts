import type { CombatAssignment } from "@/components/game/game.types";

export interface PromptActionLayoutProps {
  isWaitingForResponse: boolean;
}

export interface ChooseActionProps extends PromptActionLayoutProps {
  onPassPriority: () => void;
}

export interface ChooseAttackersProps extends PromptActionLayoutProps {
  availableAttackerIds: string[];
  pendingAttackers: string[];
  selectedDefenderId?: string | null;
  /** When true, the engine reports more than one legal defender (multi-
   *  player game, planeswalkers, sieges). Attack/Attack-All defer the
   *  declaration and ask the user to click a target instead of committing
   *  immediately against the default defender. */
  multipleDefenders: boolean;
  attackAssignmentCount: number;
  mustAttackHint?: string | null;
  onPassPriority: () => void;
  onDeclareAttackers: (attackerIds: string[], defenderId?: string) => void;
  /** Begin the click-to-pick-defender flow. Called instead of
   *  `onDeclareAttackers` when `multipleDefenders` is true. */
  onBeginAttackTargetPick: (attackerIds: string[]) => void;
  onSubmitAttack: () => void;
}

export interface ChooseBlockersProps extends PromptActionLayoutProps {
  pendingAttacker: string | null;
  pendingBlocker: string | null;
  blockError?: string | null;
  blockRequirementError?: string | null;
  blockRestrictionHint?: string | null;
  blockAssignments: CombatAssignment[];
  onPassPriority: () => void;
  onDeclareBlockers: (assignments: CombatAssignment[]) => void;
}

export interface ChooseDamageOrderProps extends PromptActionLayoutProps {
  orderedCount: number;
  totalCount: number;
  onConfirm: () => void;
  onUndo: () => void;
  onDefault: () => void;
}

export interface ChooseTargetSpellProps extends PromptActionLayoutProps {
  onOpenStack: () => void;
  completionLabel?: string;
  onCompleteTargets?: () => void;
}

export interface PayManaCostProps extends PromptActionLayoutProps {
  payManaCostInfo?: {
    cardName: string;
    manaCost: string;
    description?: string;
    manaPool: Record<string, number>;
    canConfirmFromPool: boolean;
    delveCount?: number;
    delveAvailable?: boolean;
    onOpenDelve?: () => void;
  } | null;
  onPayManaCost?: () => void;
  onAutoManaCost?: () => void;
  onCancelManaCost?: () => void;
}

export interface PromptRequiredProps extends PromptActionLayoutProps {
  hidden: boolean;
  onOpenPrompt: () => void;
}

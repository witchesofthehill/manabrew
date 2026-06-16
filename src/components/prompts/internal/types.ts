import type { CombatAssignment } from "@/components/game/game.types";
import type { PromptButtonLayout } from "@/components/prompts/PromptActionButton";

export interface PromptActionLayoutProps {
  buttonLayout: PromptButtonLayout;
  isWaitingForResponse: boolean;
}

export interface NoActionProps {
  buttonLayout: PromptButtonLayout;
  label?: string;
}

export interface ChooseActionProps extends PromptActionLayoutProps {
  onPassPriority: () => void;
}

export interface ChooseAttackersProps extends PromptActionLayoutProps {
  availableAttackerIds: string[];
  pendingAttackers: string[];
  selectedDefenderId?: string | null;
  selectedDefenderLabel?: string | null;
  /** When true, the engine reports more than one legal defender (multi-
   *  player game, planeswalkers, sieges). Attack/Attack-All defer the
   *  declaration and ask the user to click a target instead of committing
   *  immediately against the default defender. */
  multipleDefenders: boolean;
  onPassPriority: () => void;
  onDeclareAttackers: (attackerIds: string[], defenderId?: string) => void;
  /** Begin the click-to-pick-defender flow. Called instead of
   *  `onDeclareAttackers` when `multipleDefenders` is true. */
  onBeginAttackTargetPick: (attackerIds: string[]) => void;
}

export interface ChooseBlockersProps extends PromptActionLayoutProps {
  pendingAttacker: string | null;
  pendingBlocker: string | null;
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
    manaPool: Record<string, number>;
    canConfirmFromPool: boolean;
  } | null;
  onPayManaCost?: () => void;
  onAutoManaCost?: () => void;
  onCancelManaCost?: () => void;
}

export interface PromptRequiredProps extends PromptActionLayoutProps {
  hidden: boolean;
  onOpenPrompt: () => void;
}

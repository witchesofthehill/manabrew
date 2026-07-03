import type { PromptActionType, CombatAssignment } from "@/components/game/game.types";
import type { ReactElement } from "react";
import { ChooseAction } from "./ChooseAction";
import { ChooseAttackers } from "./ChooseAttackers";
import { ChooseBlockers } from "./ChooseBlockers";
import { ChooseDamageOrder } from "./ChooseDamageOrder";
import { ChooseTargetSpell } from "./ChooseTargetSpell";
import { PayManaCost } from "./PayManaCost";
import { NoAction } from "./NoAction";
import { PromptLabel } from "./PromptLabel";
import { Mulligan } from "./Mulligan";
import { MulliganPutBack } from "./MulliganPutBack";
import type { PromptType as PromptTypeValue } from "@/protocol";
import { type PromptActionViewKey, useGameDevStore } from "@/stores/useGameDevStore";
import { useGameUIStore } from "@/stores/useGameUIStore";
import { useGameStore } from "@/stores/useGameStore";
import { PromptRequired } from "./PromptRequired";

function viewKeyForPrompt(promptType: PromptTypeValue | undefined): PromptActionViewKey {
  switch (promptType) {
    case undefined:
    case "gameOver":
      return "noAction";
    case "chooseAction":
      return "chooseAction";
    case "chooseAttackers":
      return "chooseAttackers";
    case "chooseBlockers":
      return "chooseBlockers";
    case "chooseDamageAssignmentOrder":
      return "noAction";
    case "chooseBoardTargets":
      return "promptLabel";
    case "payManaCost":
      return "payManaCost";
    case "mulligan":
      return "mulligan";
    case "mulliganPutBack":
      return "mulliganPutBack";
    default:
      return "promptRequired";
  }
}

interface PromptActionControllerProps {
  promptType?: PromptActionType;
  isWaitingForResponse: boolean;
  isWaitingForOthers: boolean;
  isMyTurn: boolean;
  passToPhaseShort: string;
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
  blockAssignments: CombatAssignment[];
  onDeclareBlockers: (assignments: CombatAssignment[]) => void;
  damageOrderCount: number;
  damageOrderTotal: number;
  onConfirmDamageOrder: () => void;
  onUndoDamageOrder: () => void;
  onDefaultDamageOrder: () => void;
  onOpenStack: () => void;
  targetCompletionLabel?: string | null;
  onCompleteTargets?: (() => void) | null;
  // Pay mana cost
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
  // Mulligan
  mulliganCount?: number;
  onMulliganKeep?: () => void;
  onMulliganDraw?: () => void;
  // Mulligan put-back
  mulliganPutBackCount?: number;
  mulliganSelectedCount?: number;
  onMulliganPutBackConfirm?: () => void;
}

export function PromptActionController({
  promptType,
  isWaitingForResponse,
  isWaitingForOthers,
  isMyTurn: _isMyTurn,
  passToPhaseShort: _passToPhaseShort,
  availableAttackerIds,
  pendingAttackers,
  onPassPriority,
  selectedAttackDefenderId,
  multipleAttackDefenders,
  attackAssignmentCount,
  mustAttackHint,
  onDeclareAttackers,
  onBeginAttackTargetPick,
  onSubmitAttack,
  pendingAttacker,
  pendingBlocker,
  blockError,
  blockRequirementError,
  blockRestrictionHint,
  blockAssignments,
  onDeclareBlockers,
  damageOrderCount,
  damageOrderTotal,
  onConfirmDamageOrder,
  onUndoDamageOrder,
  onDefaultDamageOrder,
  onOpenStack,
  targetCompletionLabel,
  onCompleteTargets,
  payManaCostInfo,
  onPayManaCost,
  onAutoManaCost,
  onCancelManaCost,
  mulliganCount = 0,
  onMulliganKeep,
  onMulliganDraw,
  mulliganPutBackCount = 0,
  mulliganSelectedCount = 0,
  onMulliganPutBackConfirm,
}: PromptActionControllerProps) {
  const promptActionOverride = useGameDevStore((s) => s.promptActionOverride);
  const promptModalHidden = useGameUIStore((s) => s.promptModalHidden);
  const showPromptModal = useGameUIStore((s) => s.showPromptModal);
  const currentPromptInput = useGameStore((s) => s.currentPrompt?.input);
  const boardTargetLabel =
    currentPromptInput?.type === "chooseBoardTargets" ? currentPromptInput.label : undefined;

  const renderers: Record<PromptActionViewKey, () => ReactElement> = {
    chooseAction: () => (
      <ChooseAction isWaitingForResponse={isWaitingForResponse} onPassPriority={onPassPriority} />
    ),
    chooseAttackers: () => (
      <ChooseAttackers
        isWaitingForResponse={isWaitingForResponse}
        availableAttackerIds={availableAttackerIds}
        pendingAttackers={pendingAttackers}
        selectedDefenderId={selectedAttackDefenderId}
        multipleDefenders={multipleAttackDefenders}
        attackAssignmentCount={attackAssignmentCount}
        mustAttackHint={mustAttackHint}
        onPassPriority={onPassPriority}
        onDeclareAttackers={onDeclareAttackers}
        onBeginAttackTargetPick={onBeginAttackTargetPick}
        onSubmitAttack={onSubmitAttack}
      />
    ),
    chooseBlockers: () => (
      <ChooseBlockers
        isWaitingForResponse={isWaitingForResponse}
        pendingAttacker={pendingAttacker}
        pendingBlocker={pendingBlocker}
        blockError={blockError}
        blockRequirementError={blockRequirementError}
        blockRestrictionHint={blockRestrictionHint}
        blockAssignments={blockAssignments}
        onPassPriority={onPassPriority}
        onDeclareBlockers={onDeclareBlockers}
      />
    ),
    chooseDamageOrder: () => (
      <ChooseDamageOrder
        isWaitingForResponse={isWaitingForResponse}
        orderedCount={damageOrderCount}
        totalCount={damageOrderTotal}
        onConfirm={onConfirmDamageOrder}
        onUndo={onUndoDamageOrder}
        onDefault={onDefaultDamageOrder}
      />
    ),
    chooseTargetSpell: () => (
      <ChooseTargetSpell
        isWaitingForResponse={isWaitingForResponse}
        onOpenStack={onOpenStack}
        completionLabel={targetCompletionLabel ?? undefined}
        onCompleteTargets={onCompleteTargets ?? undefined}
      />
    ),
    payManaCost: () => (
      <PayManaCost
        isWaitingForResponse={isWaitingForResponse}
        payManaCostInfo={payManaCostInfo}
        onPayManaCost={onPayManaCost}
        onAutoManaCost={onAutoManaCost}
        onCancelManaCost={onCancelManaCost}
      />
    ),
    promptRequired: () => (
      <PromptRequired
        isWaitingForResponse={isWaitingForResponse}
        hidden={promptModalHidden}
        onOpenPrompt={showPromptModal}
      />
    ),
    promptLabel: () => {
      const labels: Record<string, string> = {
        ["chooseBoardTargets"]: "Choose a target",
        ["scry"]: "Scry",
        ["dig"]: "Choose cards",
        ["chooseCards"]: "Choose cards",
      };
      return (
        <PromptLabel
          label={boardTargetLabel || (promptType && labels[promptType]) || "Waiting..."}
          isWaitingForResponse={isWaitingForResponse}
          completionLabel={targetCompletionLabel ?? undefined}
          onCompleteTargets={onCompleteTargets ?? undefined}
        />
      );
    },
    noAction: () => <NoAction />,
    mulligan: () => (
      <Mulligan
        isWaitingForResponse={isWaitingForResponse}
        mulliganCount={mulliganCount}
        onKeep={onMulliganKeep ?? (() => {})}
        onMulligan={onMulliganDraw ?? (() => {})}
      />
    ),
    mulliganPutBack: () => (
      <MulliganPutBack
        isWaitingForResponse={isWaitingForResponse}
        count={mulliganPutBackCount}
        selectedCount={mulliganSelectedCount}
        onConfirm={onMulliganPutBackConfirm ?? (() => {})}
      />
    ),
  };

  const runtimeViewKey: PromptActionViewKey = isWaitingForOthers
    ? "noAction"
    : viewKeyForPrompt(promptType);

  const rendered = renderers[promptActionOverride ?? runtimeViewKey]();

  if (promptActionOverride) {
    return (
      <div className="contents [&_button]:pointer-events-none" aria-disabled="true">
        {rendered}
      </div>
    );
  }

  return rendered;
}

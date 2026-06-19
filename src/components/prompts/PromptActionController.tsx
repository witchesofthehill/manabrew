import type { PromptActionType, CombatAssignment } from "@/components/game/game.types";
import type { ReactElement } from "react";
import { ChooseAction } from "./ChooseAction";
import { ChooseAttackers } from "./ChooseAttackers";
import { ChooseBlockers } from "./ChooseBlockers";
import { ChooseDamageOrder } from "./ChooseDamageOrder";
import { ChooseTargetSpell } from "./ChooseTargetSpell";
import { PayManaCost } from "./PayManaCost";
import { PromptRequired } from "./PromptRequired";
import { NoAction } from "./NoAction";
import { PromptLabel } from "./PromptLabel";
import { Mulligan } from "./Mulligan";
import { MulliganPutBack } from "./MulliganPutBack";
import type { PromptType as PromptTypeValue } from "@/protocol";
import type { PromptButtonLayout } from "./PromptActionButton";
import { type PromptActionViewKey, useGameDevStore } from "@/stores/useGameDevStore";
import { useGameUIStore } from "@/stores/useGameUIStore";
import { useGameStore } from "@/stores/useGameStore";

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
      return "chooseDamageOrder";
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
  isAutoPassing: boolean;
  isPassingUntilEot: boolean;
  isMyTurn: boolean;
  passToPhaseShort: string;
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
  pendingBlocker: string | null;
  blockError?: string | null;
  blockRequirementError?: string | null;
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
  buttonLayout?: PromptButtonLayout;
  // Pay mana cost
  payManaCostInfo?: {
    cardName: string;
    manaCost: string;
    manaPool: Record<string, number>;
    canConfirmFromPool: boolean;
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
  isAutoPassing,
  isPassingUntilEot,
  isMyTurn,
  passToPhaseShort: _passToPhaseShort,
  availableAttackerIds,
  pendingAttackers,
  onPassPriority,
  onPassUntilEot: _onPassUntilEot,
  selectedAttackDefenderId,
  selectedAttackDefenderLabel,
  multipleAttackDefenders,
  onDeclareAttackers,
  onBeginAttackTargetPick,
  pendingAttacker,
  pendingBlocker,
  blockError,
  blockRequirementError,
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
  buttonLayout = "full",
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
      <ChooseAction
        buttonLayout={buttonLayout}
        isWaitingForResponse={isWaitingForResponse}
        onPassPriority={onPassPriority}
      />
    ),
    chooseAttackers: () => (
      <ChooseAttackers
        buttonLayout={buttonLayout}
        isWaitingForResponse={isWaitingForResponse}
        availableAttackerIds={availableAttackerIds}
        pendingAttackers={pendingAttackers}
        selectedDefenderId={selectedAttackDefenderId}
        selectedDefenderLabel={selectedAttackDefenderLabel}
        multipleDefenders={multipleAttackDefenders}
        onPassPriority={onPassPriority}
        onDeclareAttackers={onDeclareAttackers}
        onBeginAttackTargetPick={onBeginAttackTargetPick}
      />
    ),
    chooseBlockers: () => (
      <ChooseBlockers
        buttonLayout={buttonLayout}
        isWaitingForResponse={isWaitingForResponse}
        pendingAttacker={pendingAttacker}
        pendingBlocker={pendingBlocker}
        blockError={blockError}
        blockRequirementError={blockRequirementError}
        blockAssignments={blockAssignments}
        onPassPriority={onPassPriority}
        onDeclareBlockers={onDeclareBlockers}
      />
    ),
    chooseDamageOrder: () => (
      <ChooseDamageOrder
        buttonLayout={buttonLayout}
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
        buttonLayout={buttonLayout}
        isWaitingForResponse={isWaitingForResponse}
        onOpenStack={onOpenStack}
        completionLabel={targetCompletionLabel ?? undefined}
        onCompleteTargets={onCompleteTargets ?? undefined}
      />
    ),
    payManaCost: () => (
      <PayManaCost
        buttonLayout={buttonLayout}
        isWaitingForResponse={isWaitingForResponse}
        payManaCostInfo={payManaCostInfo}
        onPayManaCost={onPayManaCost}
        onAutoManaCost={onAutoManaCost}
        onCancelManaCost={onCancelManaCost}
      />
    ),
    promptRequired: () => (
      <PromptRequired
        buttonLayout={buttonLayout}
        isWaitingForResponse={isWaitingForResponse}
        hidden={promptModalHidden}
        onOpenPrompt={showPromptModal}
      />
    ),
    passingUntilEot: () => (
      <NoAction buttonLayout={buttonLayout} label={isMyTurn ? "End Turn" : "Pass Till End"} />
    ),
    autoPassing: () => <NoAction buttonLayout={buttonLayout} label="Auto Pass" />,
    promptLabel: () => {
      const labels: Record<string, string> = {
        ["chooseBoardTargets"]: "Choose a target",
        ["scry"]: "Scry",
        ["dig"]: "Choose cards",
        ["chooseCards"]: "Choose cards",
      };
      return (
        <PromptLabel
          buttonLayout={buttonLayout}
          label={boardTargetLabel || (promptType && labels[promptType]) || "Waiting..."}
          isWaitingForResponse={isWaitingForResponse}
          completionLabel={targetCompletionLabel ?? undefined}
          onCompleteTargets={onCompleteTargets ?? undefined}
        />
      );
    },
    noAction: () => <NoAction buttonLayout={buttonLayout} label="No Action" />,
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

  const runtimeViewKey: PromptActionViewKey = isPassingUntilEot
    ? "passingUntilEot"
    : isAutoPassing
      ? "autoPassing"
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

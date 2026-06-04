import type { PromptActionType, CombatAssignment } from "../game.types";
import type { ReactElement } from "react";
import { ChooseAction } from "./prompt-actions/ChooseAction";
import { ChooseAttackers } from "./prompt-actions/ChooseAttackers";
import { ChooseBlockers } from "./prompt-actions/ChooseBlockers";
import { ChooseTargetSpell } from "./prompt-actions/ChooseTargetSpell";
import { PayManaCost } from "./prompt-actions/PayManaCost";
import { PromptRequired } from "./prompt-actions/PromptRequired";
import { NoAction } from "./prompt-actions/NoAction";
import { PromptLabel } from "./prompt-actions/PromptLabel";
import { Mulligan } from "./prompt-actions/Mulligan";
import { MulliganPutBack } from "./prompt-actions/MulliganPutBack";
import { PromptType } from "@/types/promptType";
import type { PromptButtonLayout } from "./PromptActionButton";
import { type PromptActionViewKey, useGameDevStore } from "@/stores/useGameDevStore";
import { useGameUIStore } from "@/stores/useGameUIStore";

const PROMPT_TO_VIEW_KEY: Record<string, PromptActionViewKey> = {
  [PromptType.ChooseAction]: "chooseAction",
  [PromptType.ChooseAttackers]: "chooseAttackers",
  [PromptType.ChooseBlockers]: "chooseBlockers",
  [PromptType.ChooseTargetSpell]: "chooseTargetSpell",
  [PromptType.PayManaCost]: "payManaCost",

  [PromptType.Mulligan]: "mulligan",
  [PromptType.MulliganPutBack]: "mulliganPutBack",
  [PromptType.ChooseTargetPlayer]: "promptLabel",
  [PromptType.ChooseTargetCard]: "promptLabel",
  [PromptType.ChooseTargetAny]: "promptLabel",
  [PromptType.ChooseTargetCardFromZone]: "promptLabel",
  [PromptType.RevealCards]: "promptRequired",
  [PromptType.ChooseMode]: "promptRequired",
  [PromptType.ChooseOptionalTrigger]: "promptRequired",
  [PromptType.PayCostToPreventEffect]: "promptRequired",
  [PromptType.ChooseKicker]: "promptRequired",
  [PromptType.ChooseBuyback]: "promptRequired",
  [PromptType.ChooseMultikicker]: "promptRequired",
  [PromptType.ChooseReplicate]: "promptRequired",
  [PromptType.ChooseAlternativeCost]: "promptRequired",
  [PromptType.Scry]: "promptRequired",
  [PromptType.Surveil]: "promptRequired",
  [PromptType.Dig]: "promptRequired",
  [PromptType.ChooseDiscard]: "promptRequired",
  [PromptType.PayCombatCost]: "promptRequired",
  [PromptType.ChooseColor]: "promptRequired",
  [PromptType.ChooseType]: "promptRequired",
  [PromptType.ChooseNumber]: "promptRequired",
  [PromptType.ChooseCardName]: "promptRequired",
  [PromptType.ChooseDelve]: "promptRequired",
  [PromptType.ChooseConvoke]: "promptRequired",
  [PromptType.ChooseImprovise]: "promptRequired",
  [PromptType.SpecifyManaCombo]: "promptRequired",
  [PromptType.ChooseDamageAssignmentOrder]: "promptRequired",
  [PromptType.ChooseCombatDamageAssignment]: "promptRequired",
  [PromptType.ChooseCardsForEffect]: "promptRequired",
  [PromptType.ChoosePhyrexian]: "promptRequired",
  [PromptType.ChooseExertAttackers]: "promptRequired",
  [PromptType.ChooseEnlistAttackers]: "promptRequired",
  [PromptType.ReorderLibrary]: "promptRequired",
  [PromptType.ExploreDecision]: "promptRequired",
  [PromptType.HelpPayAssist]: "promptRequired",
};

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
  blockAssignments: CombatAssignment[];
  onDeclareBlockers: (assignments: CombatAssignment[]) => void;
  onOpenStack: () => void;
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
  blockAssignments,
  onDeclareBlockers,
  onOpenStack,
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
        blockAssignments={blockAssignments}
        onPassPriority={onPassPriority}
        onDeclareBlockers={onDeclareBlockers}
      />
    ),
    chooseTargetSpell: () => (
      <ChooseTargetSpell
        buttonLayout={buttonLayout}
        isWaitingForResponse={isWaitingForResponse}
        onOpenStack={onOpenStack}
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
        [PromptType.ChooseTargetCard]: "Choose a target",
        [PromptType.ChooseTargetPlayer]: "Choose a target player",
        [PromptType.ChooseTargetAny]: "Choose a target",
        [PromptType.ChooseTargetCardFromZone]: "Choose a target",
        [PromptType.Scry]: "Scry",
        [PromptType.Surveil]: "Surveil",
        [PromptType.Dig]: "Choose cards",
        [PromptType.ChooseDiscard]: "Discard",
      };
      return (
        <PromptLabel
          buttonLayout={buttonLayout}
          label={(promptType && labels[promptType]) || "Waiting..."}
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
      : ((promptType ? PROMPT_TO_VIEW_KEY[promptType] : undefined) ?? "noAction");

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

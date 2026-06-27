import type { MainActionOverlayProps } from "../game.types";
import { PromptActionController } from "@/components/prompts/PromptActionController";
import { CombatInfo } from "./CombatInfo";
import { PHASES } from "../game.constants";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { type PromptActionViewKey, useGameDevStore } from "@/stores/useGameDevStore";
import { cn } from "@/lib/utils";

const NO_ACTION_VIEWS: PromptActionViewKey[] = ["passingUntilEot", "autoPassing", "noAction"];

const PROMPT_TITLES: Partial<Record<string, string>> = {
  chooseAttackers: "Declare Attackers",
  chooseBlockers: "Declare Blockers",
  chooseBoardTargets: "Choose Targets",
  chooseDamageAssignmentOrder: "Damage Order",
  mulligan: "Mulligan",
  mulliganPutBack: "Mulligan",
};

export function MainActionOverlay({
  promptType,
  isWaitingForResponse,
  isAutoPassing,
  isPassingUntilEot,
  availableAttackerIds,
  pendingAttackers,
  onPassPriority,
  onPassUntilEot,
  selectedAttackDefenderId,
  selectedAttackDefenderLabel,
  multipleAttackDefenders,
  onDeclareAttackers,
  onBeginAttackTargetPick,
  pendingAttacker,
  pendingBlocker,
  blockError,
  blockRequirementError,
  attackerIds,
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
  resolveCardName,
  resolveCard,
  isMyTurn,
  step,
  payManaCostInfo,
  onPayManaCost,
  onAutoManaCost,
  onCancelManaCost,
  mulliganCount,
  onMulliganKeep,
  onMulliganDraw,
  mulliganPutBackCount,
  mulliganSelectedCount,
  onMulliganPutBackConfirm,
  selfClusterMaxHeight,
}: MainActionOverlayProps) {
  const promptActionOverride = useGameDevStore((s) => s.promptActionOverride);
  const themeColors = useTheme().gameTheme;
  if (promptType === "gameOver" || !selfClusterMaxHeight || selfClusterMaxHeight <= 0) return null;
  const panelHeight = selfClusterMaxHeight;
  const isNoActionView = promptActionOverride
    ? NO_ACTION_VIEWS.includes(promptActionOverride)
    : isPassingUntilEot || isAutoPassing || !promptType;
  const hasAction = !isNoActionView;
  const title =
    !isPassingUntilEot && !isAutoPassing && promptType ? (PROMPT_TITLES[promptType] ?? null) : null;
  const currentPhaseIndex = PHASES.findIndex((phase) => phase.id === step);
  const passToPhaseShort =
    currentPhaseIndex >= 0
      ? (PHASES[(currentPhaseIndex + 1) % PHASES.length]?.short ?? "NEXT")
      : "NEXT";
  const glow = themeColors.activeAction.priority;

  return (
    <div
      data-action-cluster
      className={cn(
        "absolute bottom-0 right-3 z-40 w-[300px] max-w-[calc(100%-12px)] flex flex-col gap-0 overflow-hidden rounded-t-lg border border-b-0 border-border/70 bg-card/95 shadow-lg backdrop-blur-sm",
        hasAction && "action-overlay-glow",
      )}
      style={
        {
          height: panelHeight,
          ...(hasAction
            ? {
                "--action-glow-ring": withAlpha(glow, 0.75),
                "--action-glow-soft": withAlpha(glow, 0.3),
                "--action-glow-ring-strong": glow,
                "--action-glow-soft-strong": withAlpha(glow, 0.6),
              }
            : {}),
        } as React.CSSProperties
      }
    >
      <section className="flex w-full flex-col gap-2 pt-2 px-2 pb-0 overflow-y-auto justify-center h-full">
        {title && (
          <span className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/90">
            {title}
          </span>
        )}
        <CombatInfo
          promptType={promptType}
          attackerIds={attackerIds}
          pendingAttackers={pendingAttackers}
          blockAssignments={blockAssignments}
          resolveCardName={resolveCardName}
          resolveCard={resolveCard}
        />
        <div
          className="flex flex-col items-center w-full [&_button]:mx-0"
          onKeyDownCapture={(e) => {
            if (e.code === "Space" && e.target instanceof HTMLButtonElement) {
              e.preventDefault();
            }
          }}
        >
          <PromptActionController
            promptType={promptType}
            isWaitingForResponse={isWaitingForResponse}
            isAutoPassing={isAutoPassing}
            isPassingUntilEot={isPassingUntilEot}
            isMyTurn={isMyTurn}
            passToPhaseShort={passToPhaseShort}
            availableAttackerIds={availableAttackerIds}
            pendingAttackers={pendingAttackers}
            onPassPriority={onPassPriority}
            onPassUntilEot={onPassUntilEot}
            selectedAttackDefenderId={selectedAttackDefenderId}
            selectedAttackDefenderLabel={selectedAttackDefenderLabel}
            multipleAttackDefenders={multipleAttackDefenders}
            onDeclareAttackers={onDeclareAttackers}
            onBeginAttackTargetPick={onBeginAttackTargetPick}
            pendingAttacker={pendingAttacker}
            pendingBlocker={pendingBlocker}
            blockError={blockError}
            blockRequirementError={blockRequirementError}
            blockAssignments={blockAssignments}
            onDeclareBlockers={onDeclareBlockers}
            damageOrderCount={damageOrderCount}
            damageOrderTotal={damageOrderTotal}
            onConfirmDamageOrder={onConfirmDamageOrder}
            onUndoDamageOrder={onUndoDamageOrder}
            onDefaultDamageOrder={onDefaultDamageOrder}
            onOpenStack={onOpenStack}
            targetCompletionLabel={targetCompletionLabel}
            onCompleteTargets={onCompleteTargets}
            payManaCostInfo={payManaCostInfo}
            onPayManaCost={onPayManaCost}
            onAutoManaCost={onAutoManaCost}
            onCancelManaCost={onCancelManaCost}
            mulliganCount={mulliganCount}
            onMulliganKeep={onMulliganKeep}
            onMulliganDraw={onMulliganDraw}
            mulliganPutBackCount={mulliganPutBackCount}
            mulliganSelectedCount={mulliganSelectedCount}
            onMulliganPutBackConfirm={onMulliganPutBackConfirm}
          />
        </div>
      </section>
    </div>
  );
}

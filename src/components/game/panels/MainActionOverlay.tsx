import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Settings } from "lucide-react";
import type { MainActionOverlayProps } from "../game.types";
import { PromptActionController } from "./PromptActionController";
import { CombatInfo } from "./CombatInfo";
import { PHASES } from "../game.constants";

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
  attackerIds,
  blockAssignments,
  onDeclareBlockers,
  onOpenStack,
  targetCompletionLabel,
  onCompleteTargets,
  onConcede,
  resolveCardName,
  resolveCard,
  isMyPriority,
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
}: MainActionOverlayProps) {
  if (promptType === "gameOver") return null;
  const buttonLayout = "modern" as const;
  const currentPhaseIndex = PHASES.findIndex((phase) => phase.id === step);
  const passToPhaseShort =
    currentPhaseIndex >= 0
      ? (PHASES[(currentPhaseIndex + 1) % PHASES.length]?.short ?? "NEXT")
      : "NEXT";

  return (
    <>
      {/* Bottom offset matches the PlayerPanel mana-row footprint
          (h-7 + gap-y-1 + bottom-2 = ~40px) so the PASS cluster sits
          at the same vertical line as the avatar / library / graveyard
          row on the left. */}
      <div className="absolute bottom-10 right-12 z-40 w-[300px] max-w-[calc(100%-12px)] flex flex-col items-end gap-0">
        {/* Prompt / action area */}
        <section className="w-full flex flex-col gap-3">
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
              blockAssignments={blockAssignments}
              onDeclareBlockers={onDeclareBlockers}
              onOpenStack={onOpenStack}
              targetCompletionLabel={targetCompletionLabel}
              onCompleteTargets={onCompleteTargets}
              buttonLayout={buttonLayout}
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

      <div className="absolute bottom-4 right-4 z-50">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 bg-black/35 hover:bg-black/55 text-white"
              title="Prompt options"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!isMyPriority}
              className="text-destructive focus:text-destructive"
              onSelect={(event) => {
                event.preventDefault();
                if (!isMyPriority) return;
                onConcede();
              }}
              onClick={() => {
                if (!isMyPriority) return;
                onConcede();
              }}
              title={isMyPriority ? undefined : "Wait until you have priority to concede"}
            >
              Concede
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

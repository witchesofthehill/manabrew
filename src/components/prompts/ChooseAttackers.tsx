import { Ban, Sword, Swords } from "lucide-react";
import { PromptActionButton } from "@/components/prompts/PromptActionButton";
import { usePromptActionColors } from "@/components/prompts/internal/promptActionTheme";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { ATTACK_DRAG_HINT } from "@/components/game/panels/promptContextHints";
import type { ChooseAttackersProps } from "./internal/types";

export function ChooseAttackers({
  isWaitingForResponse,
  availableAttackerIds,
  pendingAttackers,
  attackAssignmentCount,
  selectedDefenderId,
  multipleDefenders,
  mustAttackHint,
  onPassPriority,
  onDeclareAttackers,
  onBeginAttackTargetPick,
  onSubmitAttack,
}: ChooseAttackersProps) {
  const promptActionColors = usePromptActionColors();
  const minimal = useIsMobileGame();

  const attackAllClick = multipleDefenders
    ? () => onBeginAttackTargetPick(availableAttackerIds)
    : () => onDeclareAttackers(availableAttackerIds, selectedDefenderId ?? undefined);
  const attackCount = attackAssignmentCount + pendingAttackers.length;
  const attackClick = onSubmitAttack;

  return (
    <div className="flex flex-col items-center gap-1.5">
      {!minimal && mustAttackHint && (
        <p className="text-center text-[11px] font-medium text-muted-foreground">
          {mustAttackHint}
        </p>
      )}
      {!minimal && (
        <p className="text-center text-[11px] text-muted-foreground/70">{ATTACK_DRAG_HINT}</p>
      )}
      <div className="flex flex-row items-center justify-center gap-1.5">
        <PromptActionButton
          label="Attack All"
          icon={<Swords className="h-3.5 w-3.5" />}
          baseColor={promptActionColors.attackAction}
          onClick={attackAllClick}
          disabled={isWaitingForResponse}
        />
        <PromptActionButton
          label={!minimal && attackCount > 0 ? `Attack (${attackCount})` : "Attack"}
          icon={<Sword className="h-3.5 w-3.5" />}
          baseColor={promptActionColors.attackAction}
          badge={minimal && attackCount > 0 ? String(attackCount) : undefined}
          onClick={attackClick}
          disabled={isWaitingForResponse || attackCount === 0}
        />
        <PromptActionButton
          label="Pass"
          icon={<Ban className="h-3.5 w-3.5" />}
          variant="outline"
          baseColor={promptActionColors.passAction}
          onClick={onPassPriority}
          disabled={isWaitingForResponse}
        />
      </div>
    </div>
  );
}

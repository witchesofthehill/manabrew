import { Ban, Sword, Swords } from "lucide-react";
import { PromptActionButton } from "@/components/prompts/PromptActionButton";
import { usePromptActionColors } from "@/components/prompts/internal/promptActionTheme";
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

  // Multi-defender (multiplayer / planeswalkers / sieges): "Attack All" stages
  // every attacker as pending so a target is picked; clicking a defender assigns
  // a batch (accumulating); "Attack (N)" submits the accumulated assignments.
  // Single-defender: tap + "Attack (N)" commits the pending batch straight to it.
  const attackAllClick = multipleDefenders
    ? () => onBeginAttackTargetPick(availableAttackerIds)
    : () => onDeclareAttackers(availableAttackerIds, selectedDefenderId ?? undefined);
  const attackCount = multipleDefenders ? attackAssignmentCount : pendingAttackers.length;
  const attackClick = multipleDefenders
    ? onSubmitAttack
    : () => onDeclareAttackers(pendingAttackers, selectedDefenderId ?? undefined);

  return (
    <div className="flex flex-col items-center gap-1.5">
      {mustAttackHint && (
        <p className="text-center text-[11px] font-medium text-muted-foreground">
          {mustAttackHint}
        </p>
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
          label={attackCount > 0 ? `Attack (${attackCount})` : "Attack"}
          icon={<Sword className="h-3.5 w-3.5" />}
          baseColor={promptActionColors.attackAction}
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

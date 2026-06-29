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
  onPassPriority,
  onDeclareAttackers,
  onBeginAttackTargetPick,
  onSubmitAttack,
}: ChooseAttackersProps) {
  const promptActionColors = usePromptActionColors();
  const hasPendingAttackers = pendingAttackers.length > 0;

  // Multi-defender (multiplayer / planeswalkers / sieges): "Attack All" stages
  // every attacker as pending so the user picks a target; targets are assigned
  // by clicking a defender (accumulating across batches); "Attack (N)" submits
  // the accumulated assignments once at least one is made.
  if (multipleDefenders) {
    return (
      <div className="flex flex-row items-center justify-center gap-1.5">
        <PromptActionButton
          label="Attack All"
          icon={<Swords className="h-3.5 w-3.5" />}
          baseColor={promptActionColors.attackAction}
          onClick={() => onBeginAttackTargetPick(availableAttackerIds)}
          disabled={isWaitingForResponse}
        />
        <PromptActionButton
          label={attackAssignmentCount > 0 ? `Attack (${attackAssignmentCount})` : "Attack"}
          icon={<Sword className="h-3.5 w-3.5" />}
          baseColor={promptActionColors.attackAction}
          onClick={onSubmitAttack}
          disabled={isWaitingForResponse || attackAssignmentCount === 0}
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
    );
  }

  return (
    <div className="flex flex-row items-center justify-center gap-1.5">
      <PromptActionButton
        label="Attack All"
        icon={<Swords className="h-3.5 w-3.5" />}
        baseColor={promptActionColors.attackAction}
        onClick={() => onDeclareAttackers(availableAttackerIds, selectedDefenderId ?? undefined)}
        disabled={isWaitingForResponse}
      />
      <PromptActionButton
        label={hasPendingAttackers ? `Attack (${pendingAttackers.length})` : "Attack"}
        icon={<Sword className="h-3.5 w-3.5" />}
        baseColor={promptActionColors.attackAction}
        onClick={() => onDeclareAttackers(pendingAttackers, selectedDefenderId ?? undefined)}
        disabled={isWaitingForResponse || !hasPendingAttackers}
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
  );
}

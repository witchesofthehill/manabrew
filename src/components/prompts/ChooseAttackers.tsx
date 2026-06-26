import { Ban, Sword, Swords } from "lucide-react";
import { PromptActionButton } from "@/components/prompts/PromptActionButton";
import { usePromptActionColors } from "@/components/prompts/internal/promptActionTheme";
import type { ChooseAttackersProps } from "./internal/types";

export function ChooseAttackers({
  isWaitingForResponse,
  availableAttackerIds,
  pendingAttackers,
  selectedDefenderId,
  multipleDefenders,
  onPassPriority,
  onDeclareAttackers,
  onBeginAttackTargetPick,
}: ChooseAttackersProps) {
  const promptActionColors = usePromptActionColors();
  const hasPendingAttackers = pendingAttackers.length > 0;
  // In multi-defender games (multiplayer, planeswalkers/sieges) defer
  // committing — the user picks the target afterward by clicking an
  // avatar or a defender card.
  const handleAttack = (attackerIds: string[]) => {
    if (multipleDefenders) onBeginAttackTargetPick(attackerIds);
    else onDeclareAttackers(attackerIds, selectedDefenderId ?? undefined);
  };

  return (
    <div className="flex flex-row items-center justify-center gap-1.5">
      <PromptActionButton
        label="Attack All"
        icon={<Swords className="h-3.5 w-3.5" />}
        baseColor={promptActionColors.attackAction}
        onClick={() => handleAttack(availableAttackerIds)}
        disabled={isWaitingForResponse}
      />
      <PromptActionButton
        label={hasPendingAttackers ? `Attack (${pendingAttackers.length})` : "Attack"}
        icon={<Sword className="h-3.5 w-3.5" />}
        baseColor={promptActionColors.attackAction}
        onClick={() => handleAttack(pendingAttackers)}
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

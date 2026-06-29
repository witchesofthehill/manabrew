import { Ban, Shield } from "lucide-react";
import { PromptActionButton } from "@/components/prompts/PromptActionButton";
import { usePromptActionColors } from "@/components/prompts/internal/promptActionTheme";
import type { ChooseBlockersProps } from "./internal/types";

export function ChooseBlockers({
  isWaitingForResponse,
  pendingAttacker,
  pendingBlocker,
  blockError,
  blockRequirementError,
  blockRestrictionHint,
  blockAssignments,
  onPassPriority,
  onDeclareBlockers,
}: ChooseBlockersProps) {
  const hint = pendingAttacker
    ? "Attacker selected — click your blocker."
    : pendingBlocker
      ? "Blocker selected — click the attacker to block."
      : null;
  const promptActionColors = usePromptActionColors();

  return (
    <div className="flex flex-col items-center gap-1.5">
      {(blockError || blockRequirementError) && (
        <p
          className="text-center text-xs font-semibold"
          style={{ color: promptActionColors.attackAction }}
        >
          {blockError ?? blockRequirementError}
        </p>
      )}
      {hint && <p className="text-center text-[11px] italic text-muted-foreground">{hint}</p>}
      {!blockError && !blockRequirementError && blockRestrictionHint && (
        <p className="text-center text-[11px] font-medium text-muted-foreground">
          {blockRestrictionHint}
        </p>
      )}
      <div className="flex flex-row items-center justify-center gap-1.5">
        {blockAssignments.length > 0 && (
          <PromptActionButton
            label={`Block ${blockAssignments.length}`}
            icon={<Shield className="h-3.5 w-3.5" />}
            baseColor={promptActionColors.defenseAction}
            onClick={() => onDeclareBlockers(blockAssignments)}
            disabled={isWaitingForResponse || !!blockRequirementError}
          />
        )}
        <PromptActionButton
          label="No Blocks"
          icon={<Ban className="h-3.5 w-3.5" />}
          variant="outline"
          baseColor={promptActionColors.cancel}
          onClick={onPassPriority}
          disabled={isWaitingForResponse}
        />
      </div>
    </div>
  );
}

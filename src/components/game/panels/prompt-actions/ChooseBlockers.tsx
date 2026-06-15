import { Ban, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromptActionButton } from "@/components/game/panels/PromptActionButton";
import { BUTTON_CONFIRM_BLOCKS, PROMPT_BUTTON_COLUMN } from "@/components/game/game.styles";
import {
  getPromptActionButtonStyle,
  usePromptActionColors,
} from "@/components/game/panels/promptActionTheme";
import type { ChooseBlockersProps } from "./types";

export function ChooseBlockers({
  buttonLayout,
  isWaitingForResponse,
  pendingAttacker,
  pendingBlocker,
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

  if (buttonLayout === "modern") {
    const defenseStyle = getPromptActionButtonStyle(promptActionColors.defenseAction);

    return (
      <div className="flex w-3/5 flex-col gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-9 w-full rounded-lg text-sm font-black tracking-[0.12em] !border-0 !text-white transition-[filter,box-shadow] hover:brightness-105"
          onClick={onPassPriority}
          disabled={isWaitingForResponse}
          style={defenseStyle}
        >
          NO BLOCKERS
        </Button>
        {hint && <p className="text-xs italic text-muted-foreground text-center">{hint}</p>}
        {blockAssignments.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-9 w-full rounded-lg text-sm font-black tracking-[0.12em] !border-0 !text-white transition-[filter,box-shadow] hover:brightness-105 gap-1.5"
            onClick={() => onDeclareBlockers(blockAssignments)}
            disabled={isWaitingForResponse}
            style={defenseStyle}
          >
            <Shield className="h-3.5 w-3.5" />
            {`BLOCK (${blockAssignments.length})`}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={PROMPT_BUTTON_COLUMN}>
      <PromptActionButton
        layout={buttonLayout}
        label="No Blockers"
        icon={<Ban className="h-3.5 w-3.5" />}
        variant="outline"
        baseColor={promptActionColors.defenseAction}
        onClick={onPassPriority}
        disabled={isWaitingForResponse}
      />
      {hint && <p className="text-xs italic text-muted-foreground">{hint}</p>}
      {blockAssignments.length > 0 && (
        <PromptActionButton
          layout={buttonLayout}
          label={`Block (${blockAssignments.length})`}
          icon={<Shield className="h-3.5 w-3.5" />}
          className={BUTTON_CONFIRM_BLOCKS}
          baseColor={promptActionColors.defenseAction}
          onClick={() => onDeclareBlockers(blockAssignments)}
          disabled={isWaitingForResponse}
        />
      )}
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { PROMPT_BUTTON_COLUMN } from "@/components/game/game.styles";
import {
  getPromptActionButtonStyle,
  usePromptActionColors,
} from "@/components/prompts/internal/promptActionTheme";
import { PromptActionButton } from "@/components/prompts/PromptActionButton";
import { Ban } from "lucide-react";
import type { ChooseActionProps } from "./internal/types";

export function ChooseAction({
  buttonLayout,
  isWaitingForResponse,
  hasAvailableActions = true,
  onPassPriority,
}: ChooseActionProps) {
  const promptActionColors = usePromptActionColors();

  if (buttonLayout === "modern") {
    const passActionStyle = getPromptActionButtonStyle(promptActionColors.passAction);

    return (
      <div className="flex w-3/5 flex-col gap-1.5">
        {!hasAvailableActions && (
          <div className="rounded-md border border-white/15 bg-black/35 px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-white/80">
            No available actions
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-9 w-full rounded-lg text-sm font-black tracking-[0.12em] !border-0 !text-white transition-[filter,box-shadow] hover:brightness-105"
          onClick={onPassPriority}
          disabled={isWaitingForResponse}
          style={passActionStyle}
        >
          PASS
        </Button>
      </div>
    );
  }

  return (
    <div className={PROMPT_BUTTON_COLUMN}>
      {!hasAvailableActions && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-center text-xs font-medium text-muted-foreground">
          No available actions
        </div>
      )}
      <PromptActionButton
        layout={buttonLayout}
        label="Pass (Space)"
        icon={<Ban className="h-3.5 w-3.5" />}
        variant="outline"
        baseColor={promptActionColors.passAction}
        onClick={onPassPriority}
        disabled={isWaitingForResponse}
      />
    </div>
  );
}

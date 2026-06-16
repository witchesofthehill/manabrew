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
  onPassPriority,
}: ChooseActionProps) {
  const promptActionColors = usePromptActionColors();

  if (buttonLayout === "modern") {
    const passActionStyle = getPromptActionButtonStyle(promptActionColors.passAction);

    return (
      <div className="flex w-3/5 flex-col gap-1.5">
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

import { Button } from "@/components/ui/button";
import {
  getPromptActionButtonStyle,
  usePromptActionColors,
} from "@/components/prompts/internal/promptActionTheme";
import type { ChooseActionProps } from "./internal/types";

export function ChooseAction({ isWaitingForResponse, onPassPriority }: ChooseActionProps) {
  const promptActionColors = usePromptActionColors();
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

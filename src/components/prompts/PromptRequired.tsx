import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PromptRequiredProps } from "./internal/types";
import {
  getPromptActionButtonStyle,
  usePromptActionColors,
} from "@/components/prompts/internal/promptActionTheme";

export function PromptRequired({
  buttonLayout,
  isWaitingForResponse,
  hidden,
  onOpenPrompt,
}: PromptRequiredProps) {
  const promptActionColors = usePromptActionColors();
  const themedStyle = getPromptActionButtonStyle(promptActionColors.cancel);

  if (buttonLayout === "modern") {
    return (
      <div className="flex w-50 flex-col gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className={`h-9 w-full rounded-lg text-sm font-black tracking-[0.06em] !border-0 !text-white ${hidden ? "animate-pulse" : ""}`}
          style={themedStyle}
          onClick={onOpenPrompt}
          disabled={isWaitingForResponse}
          title={hidden ? "Prompt required. Click to reopen." : "Prompt is open."}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          {hidden ? "PROMPT REQUIRED" : "PROMPT OPEN"}
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className={hidden ? "animate-pulse" : undefined}
      style={themedStyle}
      onClick={onOpenPrompt}
      disabled={isWaitingForResponse}
      title={hidden ? "Prompt required. Click to reopen." : "Prompt is open."}
    >
      <AlertCircle className="h-4 w-4" />
      {hidden ? "Prompt Required" : "Prompt Open"}
    </Button>
  );
}

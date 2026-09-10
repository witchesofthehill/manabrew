import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PromptRequiredProps } from "./internal/types";
import {
  getPromptActionButtonStyle,
  usePromptActionColors,
} from "@/components/prompts/internal/promptActionTheme";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { cn } from "@/lib/utils";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export function PromptRequired({
  isWaitingForResponse,
  hidden,
  onOpenPrompt,
}: PromptRequiredProps) {
  const promptActionColors = usePromptActionColors();
  const themedStyle = getPromptActionButtonStyle(promptActionColors.cancel);
  const minimal = useIsMobileGame();
  if (minimal) {
    return (
      <Button
        size="sm"
        variant="outline"
        className={cn(
          "h-10 rounded-full px-3 text-xs font-black tracking-[0.06em] !border-0 !text-white",
          hidden && "animate-pulse",
        )}
        style={themedStyle}
        onClick={onOpenPrompt}
        disabled={isWaitingForResponse}
        title={hidden ? "Prompt required. Click to reopen." : "Prompt is open."}
      >
        <Trans>
          <AlertCircle className="h-3.5 w-3.5" />
          PROMPT
        </Trans>
      </Button>
    );
  }
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
        {hidden ? i18n._(msg`PROMPT REQUIRED`) : i18n._(msg`PROMPT OPEN`)}
      </Button>
    </div>
  );
}

import { Ban, Check, WandSparkles } from "lucide-react";
import { VortexCircleIcon } from "@/components/icons/VortexCircleIcon";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { PROMPT_BUTTON_COLUMN } from "@/components/game/game.styles";
import { PromptActionButton } from "@/components/prompts/PromptActionButton";
import { usePromptActionColors } from "@/components/prompts/internal/promptActionTheme";
import { cn } from "@/lib/utils";
import type { PayManaCostProps } from "./internal/types";

export function PayManaCost({
  isWaitingForResponse,
  payManaCostInfo,
  onPayManaCost,
  onAutoManaCost,
  onCancelManaCost,
}: PayManaCostProps) {
  const promptActionColors = usePromptActionColors();
  // If the player has already tapped enough mana by hand, the primary
  // button commits that payment directly — swap the wand for a check
  // mark so the state is obvious. Otherwise it's the classic auto-tap
  // button that asks the engine to finish the job.
  const canConfirmFromPool = payManaCostInfo?.canConfirmFromPool ?? false;
  const primaryLabel = canConfirmFromPool ? "Confirm" : "Auto";
  const primaryAction = canConfirmFromPool ? onPayManaCost : onAutoManaCost;
  const primaryIcon = canConfirmFromPool ? (
    <Check className="h-3.5 w-3.5" strokeWidth={3} />
  ) : (
    <WandSparkles className="h-3.5 w-3.5" />
  );
  return (
    <div className={cn(PROMPT_BUTTON_COLUMN, "w-full")}>
      {payManaCostInfo && (
        <>
          {payManaCostInfo.description ? (
            <p className="text-xs text-muted-foreground">
              <DynamicTextRender className="align-middle" text={payManaCostInfo.description} />
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Cast <span className="font-semibold text-foreground">{payManaCostInfo.cardName}</span>{" "}
              for <DynamicTextRender className="align-middle" text={payManaCostInfo.manaCost} />
            </p>
          )}
          {!!payManaCostInfo.delveCount && (
            <p className="text-xs text-muted-foreground">
              Delved for{" "}
              <DynamicTextRender
                className="align-middle"
                text={`{${payManaCostInfo.delveCount}}`}
              />
            </p>
          )}
        </>
      )}
      <div className={"flex flex-row flex-wrap items-center justify-center gap-3"}>
        <PromptActionButton
          label={primaryLabel}
          icon={primaryIcon}
          onClick={primaryAction}
          disabled={isWaitingForResponse}
        />
        {payManaCostInfo?.delveAvailable && payManaCostInfo.onOpenDelve && (
          <PromptActionButton
            label="Delve"
            icon={<VortexCircleIcon className="h-3.5 w-3.5" />}
            variant="outline"
            baseColor={promptActionColors.defenseAction}
            onClick={payManaCostInfo.onOpenDelve}
            disabled={isWaitingForResponse}
          />
        )}
        <PromptActionButton
          label="Cancel"
          icon={<Ban className="h-3.5 w-3.5" />}
          variant="outline"
          baseColor={promptActionColors.cancel}
          onClick={onCancelManaCost}
          disabled={isWaitingForResponse}
        />
      </div>
    </div>
  );
}

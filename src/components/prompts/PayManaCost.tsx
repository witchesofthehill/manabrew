import { Ban, Check, WandSparkles } from "lucide-react";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { ManaPool } from "@/components/game/panels/ManaPool";
import { PROMPT_BUTTON_COLUMN } from "@/components/game/game.styles";
import { PromptActionButton } from "@/components/prompts/PromptActionButton";
import { usePromptActionColors } from "@/components/prompts/internal/promptActionTheme";
import { cn } from "@/lib/utils";
import type { PayManaCostProps } from "./internal/types";

export function PayManaCost({
  buttonLayout,
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
  const buttonGroupClass =
    buttonLayout === "modern"
      ? "flex flex-row flex-wrap items-center justify-center gap-3"
      : PROMPT_BUTTON_COLUMN;

  return (
    <div className={cn(PROMPT_BUTTON_COLUMN, "w-full")}>
      {payManaCostInfo && (
        <>
          <p className="text-xs text-muted-foreground">
            Cast <span className="font-semibold text-foreground">{payManaCostInfo.cardName}</span>{" "}
            for <DynamicTextRender text={payManaCostInfo.manaCost} />
          </p>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Mana pool:</span>
            <ManaPool pool={payManaCostInfo.manaPool} />
          </div>
          <p className="min-h-[32px] text-[11px] text-muted-foreground/70">
            Tap lands to generate mana, or let the engine finish payment.
          </p>
        </>
      )}
      <div className={buttonGroupClass}>
        <PromptActionButton
          layout={buttonLayout}
          label={primaryLabel}
          icon={primaryIcon}
          onClick={primaryAction}
          disabled={isWaitingForResponse}
        />
        <PromptActionButton
          layout={buttonLayout}
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

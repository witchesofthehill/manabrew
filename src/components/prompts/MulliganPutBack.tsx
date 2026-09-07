/**
 * Confirm button for the mulligan put-back phase. Shares the
 * `MulliganButton` shell with the keep/mulligan prompt above so the
 * flow reads as a single sequence.
 */
import { Check } from "lucide-react";
import { usePromptActionColors } from "@/components/prompts/internal/promptActionTheme";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { PromptActionButton } from "./PromptActionButton";
import { MulliganButton } from "./MulliganButton";

export interface MulliganPutBackProps {
  isWaitingForResponse: boolean;
  count: number;
  selectedCount: number;
  onConfirm: () => void;
}

export function MulliganPutBack({
  isWaitingForResponse,
  count,
  selectedCount,
  onConfirm,
}: MulliganPutBackProps) {
  const colors = usePromptActionColors();
  const minimal = useIsMobileGame();
  const canConfirm = selectedCount === count && !isWaitingForResponse;

  if (minimal) {
    return (
      <div className="flex flex-row items-center justify-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {selectedCount}/{count}
        </span>
        <PromptActionButton
          label="Confirm"
          icon={<Check className="h-3.5 w-3.5" />}
          baseColor={colors.defenseAction}
          onClick={onConfirm}
          disabled={!canConfirm}
        />
      </div>
    );
  }

  return (
    <div className="flex w-3/5 flex-col gap-1.5">
      <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {selectedCount}/{count} to library bottom
      </p>
      <MulliganButton
        className="w-full"
        color={colors.defenseAction}
        label="CONFIRM"
        icon={<Check className="h-3.5 w-3.5" />}
        onClick={onConfirm}
        disabled={!canConfirm}
      />
    </div>
  );
}

/**
 * Keep / Mulligan buttons rendered inside `MainActionOverlay` — the
 * same bottom-right slot that hosts Pass Priority during normal play.
 * The full-width buttons (`MulliganButton`) always show a visible
 * label so the two options are distinguishable without a hover tip.
 */
import { Check, RotateCw } from "lucide-react";
import { usePromptActionColors } from "@/components/prompts/internal/promptActionTheme";
import { MulliganButton } from "./MulliganButton";

export interface MulliganProps {
  isWaitingForResponse: boolean;
  mulliganCount: number;
  onKeep: () => void;
  onMulligan: () => void;
}

export function Mulligan({
  isWaitingForResponse,
  mulliganCount,
  onKeep,
  onMulligan,
}: MulliganProps) {
  const colors = usePromptActionColors();
  const subtitle =
    mulliganCount === 0
      ? "Opening hand"
      : `Mulligan ${mulliganCount} · keep puts ${mulliganCount} back`;

  return (
    <div className="flex w-3/5 flex-col gap-1.5">
      <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {subtitle}
      </p>
      <MulliganButton
        color={colors.defenseAction}
        label="KEEP"
        icon={<Check className="h-3.5 w-3.5" />}
        onClick={onKeep}
        disabled={isWaitingForResponse}
      />
      <MulliganButton
        color={colors.cancel}
        label="MULLIGAN"
        icon={<RotateCw className="h-3.5 w-3.5" />}
        onClick={onMulligan}
        disabled={isWaitingForResponse}
      />
    </div>
  );
}

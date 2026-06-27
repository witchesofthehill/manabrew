/**
 * Keep / Mulligan buttons rendered inside `MainActionOverlay` — the
 * same bottom-right slot that hosts Pass Priority during normal play.
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

export function Mulligan({ isWaitingForResponse, onKeep, onMulligan }: MulliganProps) {
  const colors = usePromptActionColors();

  return (
    <div className="flex flex-row items-center justify-center gap-1.5">
      <MulliganButton
        className="flex-1"
        color={colors.defenseAction}
        label="Keep"
        icon={<Check className="h-3.5 w-3.5" />}
        onClick={onKeep}
        disabled={isWaitingForResponse}
      />
      <MulliganButton
        className="flex-1"
        color={colors.cancel}
        label="Mulligan"
        icon={<RotateCw className="h-3.5 w-3.5" />}
        onClick={onMulligan}
        disabled={isWaitingForResponse}
      />
    </div>
  );
}

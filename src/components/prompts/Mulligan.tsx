/**
 * Keep / Mulligan buttons rendered inside `MainActionOverlay` — the
 * same bottom-right slot that hosts Pass Priority during normal play.
 */
import { Check, RotateCw } from "lucide-react";
import { usePromptActionColors } from "@/components/prompts/internal/promptActionTheme";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { PromptActionButton } from "./PromptActionButton";
import { MulliganButton } from "./MulliganButton";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
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
  const minimal = useIsMobileGame();
  if (minimal) {
    return (
      <div className="flex flex-row items-center justify-center gap-1.5">
        <PromptActionButton
          label={i18n._(msg`Keep`)}
          icon={<Check className="h-3.5 w-3.5" />}
          baseColor={colors.defenseAction}
          onClick={onKeep}
          disabled={isWaitingForResponse}
        />
        <PromptActionButton
          label={i18n._(msg`Mulligan`)}
          icon={<RotateCw className="h-3.5 w-3.5" />}
          baseColor={colors.cancel}
          badge={mulliganCount > 0 ? String(mulliganCount) : undefined}
          onClick={onMulligan}
          disabled={isWaitingForResponse}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-row items-center justify-center gap-1.5">
      <MulliganButton
        className="flex-1"
        color={colors.defenseAction}
        label={i18n._(msg`Keep`)}
        icon={<Check className="h-3.5 w-3.5" />}
        onClick={onKeep}
        disabled={isWaitingForResponse}
      />
      <MulliganButton
        className="flex-1"
        color={colors.cancel}
        label={i18n._(msg`Mulligan`)}
        icon={<RotateCw className="h-3.5 w-3.5" />}
        onClick={onMulligan}
        disabled={isWaitingForResponse}
      />
    </div>
  );
}

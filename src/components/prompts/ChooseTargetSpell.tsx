import { Ban, Check, Layers } from "lucide-react";
import { PromptActionButton } from "@/components/prompts/PromptActionButton";
import { usePromptActionColors } from "./internal/promptActionTheme";
import type { ChooseTargetSpellProps } from "./internal/types";

export function ChooseTargetSpell({
  isWaitingForResponse,
  onOpenStack,
  completionLabel,
  completionKind,
  onCompleteTargets,
}: ChooseTargetSpellProps) {
  const promptActionColors = usePromptActionColors();
  const isCancel = completionKind === "cancel";
  return (
    <div className="flex items-center gap-1.5">
      <PromptActionButton
        label="View Stack"
        title="Click a glowing spell on the stack to counter it"
        icon={<Layers className="h-3.5 w-3.5" />}
        onClick={onOpenStack}
        disabled={isWaitingForResponse}
      />
      {onCompleteTargets && (
        <PromptActionButton
          label={completionLabel ?? "Done"}
          icon={isCancel ? <Ban className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          variant={isCancel ? "outline" : "default"}
          baseColor={isCancel ? promptActionColors.cancel : undefined}
          onClick={onCompleteTargets}
          disabled={isWaitingForResponse}
        />
      )}
    </div>
  );
}

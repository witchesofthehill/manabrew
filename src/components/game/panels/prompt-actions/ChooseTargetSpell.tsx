import { Check, Layers } from "lucide-react";
import { PromptActionButton } from "@/components/game/panels/PromptActionButton";
import type { ChooseTargetSpellProps } from "./types";

export function ChooseTargetSpell({
  buttonLayout,
  isWaitingForResponse,
  onOpenStack,
  completionLabel,
  onCompleteTargets,
}: ChooseTargetSpellProps) {
  return (
    <div className="flex items-center gap-1.5">
      <PromptActionButton
        layout={buttonLayout}
        label="View Stack"
        title="Click a glowing spell on the stack to counter it"
        icon={<Layers className="h-3.5 w-3.5" />}
        onClick={onOpenStack}
        disabled={isWaitingForResponse}
      />
      {onCompleteTargets && (
        <PromptActionButton
          layout={buttonLayout}
          label={completionLabel ?? "Done"}
          icon={<Check className="h-3.5 w-3.5" />}
          onClick={onCompleteTargets}
          disabled={isWaitingForResponse}
        />
      )}
    </div>
  );
}

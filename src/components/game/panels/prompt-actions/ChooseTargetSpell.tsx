import { Layers } from "lucide-react";
import { PromptActionButton } from "@/components/game/panels/PromptActionButton";
import type { ChooseTargetSpellProps } from "./types";

export function ChooseTargetSpell({
  buttonLayout,
  isWaitingForResponse,
  onOpenStack,
}: ChooseTargetSpellProps) {
  return (
    <PromptActionButton
      layout={buttonLayout}
      label="View Stack"
      title="Click a glowing spell on the stack to counter it"
      icon={<Layers className="h-3.5 w-3.5" />}
      onClick={onOpenStack}
      disabled={isWaitingForResponse}
    />
  );
}

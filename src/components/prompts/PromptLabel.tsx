import { Check, Crosshair } from "lucide-react";
import { PromptActionButton } from "@/components/prompts/PromptActionButton";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";

interface PromptLabelProps {
  label: string;
  isWaitingForResponse?: boolean;
  completionLabel?: string;
  onCompleteTargets?: () => void;
}

export function PromptLabel({
  label,
  isWaitingForResponse,
  completionLabel,
  onCompleteTargets,
}: PromptLabelProps) {
  const completionButton = onCompleteTargets ? (
    <PromptActionButton
      label={completionLabel ?? "Done"}
      icon={<Check className="h-3.5 w-3.5" />}
      onClick={onCompleteTargets}
      disabled={isWaitingForResponse}
    />
  ) : null;

  return (
    <div className="flex w-3/5 items-center gap-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 h-9 px-3 rounded-lg border border-white/20 bg-white/5 text-white/80">
        <Crosshair className="h-3.5 w-3.5 shrink-0 animate-pulse" />
        <span className="text-xs font-semibold tracking-wide truncate">
          <DynamicTextRender text={label} />
        </span>
      </div>
      {completionButton}
    </div>
  );
}

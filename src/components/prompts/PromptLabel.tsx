import { Check, Crosshair } from "lucide-react";
import {
  PromptActionButton,
  type PromptButtonLayout,
} from "@/components/prompts/PromptActionButton";

interface PromptLabelProps {
  buttonLayout: PromptButtonLayout;
  label: string;
  isWaitingForResponse?: boolean;
  completionLabel?: string;
  onCompleteTargets?: () => void;
}

export function PromptLabel({
  buttonLayout,
  label,
  isWaitingForResponse,
  completionLabel,
  onCompleteTargets,
}: PromptLabelProps) {
  const completionButton = onCompleteTargets ? (
    <PromptActionButton
      layout={buttonLayout}
      label={completionLabel ?? "Done"}
      icon={<Check className="h-3.5 w-3.5" />}
      onClick={onCompleteTargets}
      disabled={isWaitingForResponse}
    />
  ) : null;

  if (buttonLayout === "modern") {
    return (
      <div className="flex w-3/5 items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 h-9 px-3 rounded-lg border border-white/20 bg-white/5 text-white/80">
          <Crosshair className="h-3.5 w-3.5 shrink-0 animate-pulse" />
          <span className="text-xs font-semibold tracking-wide truncate">{label}</span>
        </div>
        {completionButton}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
      <Crosshair className="h-4 w-4 shrink-0 animate-pulse" />
      <span className="font-medium">{label}</span>
      {completionButton}
    </div>
  );
}

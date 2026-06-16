import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StackObject } from "@/types/manabrew";
import type { PromptActionType } from "./game.types";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";

interface StackSectionProps {
  stack: StackObject[];
  promptType?: PromptActionType;
  onOpenStack: () => void;
}

export function StackSection({ stack, promptType, onOpenStack }: StackSectionProps) {
  const isCounterPrompt = promptType === "chooseBoardTargets";
  const show = stack.length > 0 || isCounterPrompt;

  const themeColors = useTheme().gameTheme;
  const accentColor = themeColors.cardRing;

  if (!show) return null;

  return (
    <div
      className={cn("rounded-lg p-2", !isCounterPrompt && "bg-muted/20")}
      style={isCounterPrompt ? { backgroundColor: withAlpha(accentColor, 0.08) } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className={cn("text-xs font-semibold", !isCounterPrompt && "text-muted-foreground")}
          style={isCounterPrompt ? { color: accentColor } : undefined}
        >
          Stack ({stack.length})
        </p>
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onOpenStack}>
          View
        </Button>
      </div>
      {stack.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {[...stack]
            .reverse()
            .slice(0, 5)
            .map((obj, idx) => (
              <span key={obj.id} className="text-[11px] text-muted-foreground truncate">
                {idx === 0 ? "[TOP] " : ""}
                {obj.name}
                {obj.isCasting ? " (casting)" : ""}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

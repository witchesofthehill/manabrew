import { cn } from "@/lib/utils";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { useEffect } from "react";

interface HandCardActionsProps {
  actions: HandActionOption[];
  onSelectAction: (action: HandActionOption) => void;
}

export function HandCardActions({ actions, onSelectAction }: HandCardActionsProps) {
  const themeColors = useTheme().gameTheme;
  const ringColor = themeColors.cardRing;

  useEffect(() => {
    if (!actions || actions.length === 0) return;

    function handleKey(e: KeyboardEvent) {
      // Number keys 1-9 activate the corresponding action
      const num = parseInt(e.key);
      if (num >= 1 && num <= actions.length) {
        e.preventDefault();
        onSelectAction(actions[num - 1]);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [actions, onSelectAction]);

  if (!actions || actions.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-1.5 z-[200] w-[220px]"
      onMouseDown={(e) => {
        // Prevent click from bubbling to the card
        e.stopPropagation();
      }}
    >
      {actions.map((action, idx) => (
        <button
          key={idx}
          onClick={(e) => {
            e.stopPropagation();
            onSelectAction(action);
          }}
          className={cn(
            "group w-full text-left rounded-lg text-xs font-medium",
            "bg-popover text-popover-foreground border border-border",
            "backdrop-blur-md shadow-lg",
            "transition-all duration-150 ease-out",
            "hover:scale-[1.02] hover:-translate-y-px hover:shadow-xl",
            "flex flex-col px-3 py-2",
          )}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = withAlpha(ringColor, 0.12);
            e.currentTarget.style.borderColor = ringColor;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "";
            e.currentTarget.style.borderColor = "";
          }}
        >
          <span className="flex items-center justify-between w-full pointer-events-none mb-0.5">
            <span className="text-[12px] font-bold min-w-[22px] h-5 flex items-center justify-center rounded border border-border bg-muted shadow-[0_1px_0_rgba(0,0,0,0.1)]">
              {idx + 1}
            </span>
            {action.cost && (
              <span className="flex items-center gap-0.5 text-[11px] opacity-90">
                <DynamicTextRender text={action.cost} />
              </span>
            )}
          </span>
          <span className="leading-snug text-[13px] font-semibold pointer-events-none">
            <DynamicTextRender text={action.label} />
          </span>
        </button>
      ))}
    </div>
  );
}

import { cn } from "@/lib/utils";
import type { CardDto } from "@/protocol/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { useTheme } from "@/hooks/useTheme";
import { useEffect } from "react";
import { useResolvedGameCard } from "@/hooks/useResolvedGameCard";
import { localizeRulesPreviewText } from "@/pixi/cardPreview/rulesCardPreviewPresentation";
import { gameCardFaceIndex } from "@/lib/gameCard";

interface HandCardActionsProps {
  card: CardDto;
  actions: HandActionOption[];
  onSelectAction: (action: HandActionOption) => void;
}

export function HandCardActions({ card, actions, onSelectAction }: HandCardActionsProps) {
  const themeColors = useTheme().gameTheme;
  const ringColor = themeColors.cardRing;
  const info = useResolvedGameCard(card).info;

  useEffect(() => {
    if (!actions || actions.length === 0) return;

    function handleKey(e: KeyboardEvent) {
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
      className="flex max-h-[min(32rem,70dvh)] max-w-[calc(100vw-1rem)] flex-col gap-1.5 overflow-y-auto overscroll-contain z-[200] w-[220px]"
      onMouseDown={(e) => {
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
            "group shrink-0 min-h-8 touch:min-h-11 touch:min-w-11 w-full text-left rounded-lg text-ui-label font-medium break-words",
            "bg-popover text-popover-foreground border border-border",
            "backdrop-blur-md shadow-lg",
            "transition-all duration-150 ease-out",
            "hover:scale-[1.02] hover:-translate-y-px hover:shadow-xl",
            "flex flex-col px-3 py-2",
          )}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = ringColor;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "";
            e.currentTarget.style.borderColor = "";
          }}
        >
          <span className="flex flex-wrap items-center justify-between gap-1 w-full pointer-events-none mb-0.5">
            <span className="text-ui-meta font-bold min-w-[22px] min-h-5 px-1 flex items-center justify-center rounded border border-border bg-muted shadow-[0_1px_0_rgba(0,0,0,0.1)]">
              {idx + 1}
            </span>
            {action.cost && (
              <span className="flex flex-wrap items-center gap-0.5 text-ui-meta opacity-90">
                <DynamicTextRender text={action.cost} />
              </span>
            )}
          </span>
          <span className="leading-snug text-ui-label font-semibold pointer-events-none">
            <DynamicTextRender
              text={localizeRulesPreviewText(action.label, info ?? null, gameCardFaceIndex(card))}
            />
          </span>
        </button>
      ))}
    </div>
  );
}

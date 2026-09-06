import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { cn } from "@/lib/utils";
import type { HandActionOption } from "@/stores/useGameUIStore";

export interface IndexedPreviewAction {
  action: HandActionOption;
  index: number;
  shortcut: number;
}

export function CardPreviewActions({
  actions,
  onSelect,
  ringColor,
  showHelp,
  hasFlippableFaces,
}: {
  actions: IndexedPreviewAction[];
  onSelect: (action: HandActionOption) => void;
  ringColor: string;
  showHelp: boolean;
  hasFlippableFaces: boolean;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        {actions.map(({ action, index, shortcut }) => (
          <button
            key={index}
            onClick={() => onSelect(action)}
            className={cn(
              "group flex w-full flex-col rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs font-medium text-popover-foreground shadow-lg backdrop-blur-md",
              "transition-all duration-150 ease-out",
              "hover:scale-[1.02] hover:-translate-y-px hover:shadow-xl",
            )}
            onMouseEnter={(event) => {
              event.currentTarget.style.borderColor = ringColor;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.borderColor = "";
            }}
          >
            <span className="mb-0.5 flex w-full items-center justify-between">
              <span className="flex h-5 min-w-[22px] items-center justify-center rounded border border-border bg-muted text-xs font-bold shadow-[0_1px_0_rgba(0,0,0,0.1)]">
                {shortcut}
              </span>
              {action.cost && (
                <span className="flex items-center gap-0.5 text-[11px] opacity-90">
                  <DynamicTextRender text={action.cost} />
                </span>
              )}
            </span>
            <span className="text-[13px] font-semibold leading-snug">
              <DynamicTextRender text={action.label} />
            </span>
          </button>
        ))}
      </div>
      {showHelp && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[10px] text-muted-foreground">
          <span>
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">1</kbd>
            -
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">9</kbd>{" "}
            select
          </span>
          <span>
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">
              Esc
            </kbd>{" "}
            close
          </span>
          {hasFlippableFaces && (
            <span>
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">
                F
              </kbd>{" "}
              flip
            </span>
          )}
        </div>
      )}
    </>
  );
}

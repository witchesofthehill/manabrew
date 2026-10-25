import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { cn } from "@/lib/utils";
import type { HandActionOption } from "@/stores/useGameUIStore";
export interface IndexedPreviewAction {
  action: HandActionOption;
  index: number;
  shortcut: number;
  displayLabel: string;
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
        {actions.map(({ action, index, shortcut, displayLabel }) => (
          <button
            key={index}
            onClick={() => onSelect(action)}
            className={cn(
              "group flex min-h-8 touch:min-h-11 touch:min-w-11 w-full flex-col rounded-lg border border-border bg-popover px-3 py-2 text-left text-ui-label font-medium text-popover-foreground shadow-lg backdrop-blur-md break-words",
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
            <span className="mb-0.5 flex w-full flex-wrap items-center justify-between gap-1">
              <span className="flex min-h-5 min-w-[22px] items-center justify-center rounded border border-border bg-muted px-1 text-ui-meta font-bold shadow-[0_1px_0_rgba(0,0,0,0.1)]">
                {shortcut}
              </span>
              {action.cost && (
                <span className="flex flex-wrap items-center gap-0.5 text-ui-meta opacity-90">
                  <DynamicTextRender text={action.cost} />
                </span>
              )}
            </span>
            <span className="text-ui-label font-semibold leading-snug">
              <DynamicTextRender text={displayLabel} />
            </span>
          </button>
        ))}
      </div>
      {showHelp && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-ui-meta text-muted-foreground">
          <span>
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-ui-meta">
              1
            </kbd>
            -
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-ui-meta">
              9
            </kbd>{" "}
            select
          </span>
          <span>
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-ui-meta">
              Esc
            </kbd>{" "}
            close
          </span>
          {hasFlippableFaces && (
            <span>
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-ui-meta">
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

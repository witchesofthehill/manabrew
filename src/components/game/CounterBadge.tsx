import { cn } from "@/lib/utils";
import type { GameThemeColors } from "@/themes/gameTheme";
import { GameIcon } from "./GameIcon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { counterBadgePresentation, getCounterConfig } from "./cardPresentation";
/** Static `bg-counter-*` class per counter colour key — Tailwind JIT
 *  needs the full class name in source, so we can't string-build it. */
const COUNTER_BG_CLASS: Record<keyof GameThemeColors["counter"], string> = {
  default: "bg-counter-default",
  p1p1: "bg-counter-p1p1",
  m1m1: "bg-counter-m1m1",
  loyalty: "bg-counter-loyalty",
  charge: "bg-counter-charge",
  quest: "bg-counter-quest",
  study: "bg-counter-study",
  lore: "bg-counter-lore",
  age: "bg-counter-age",
  time: "bg-counter-time",
  fade: "bg-counter-fade",
  level: "bg-counter-level",
  storage: "bg-counter-storage",
  mining: "bg-counter-mining",
  brick: "bg-counter-brick",
  depletion: "bg-counter-depletion",
  page: "bg-counter-page",
  shield: "bg-counter-shield",
};
export type CounterSize = "sm" | "md" | "lg";
interface SizeTokens {
  pill: string; // outer element classes
  symbol: string; // icon box size
  text: string; // text-label font size
  count: string; // count text size
}
const SIZE_TOKENS: Record<CounterSize, SizeTokens> = {
  sm: {
    pill: "h-4 min-w-[1rem] px-1 gap-px",
    symbol: "h-3 w-3",
    text: "text-[8px]",
    count: "text-[7px]",
  },
  md: {
    pill: "min-h-5 min-w-[1.25rem] px-1.5 py-0.5 gap-0.5",
    symbol: "h-3.5 w-3.5",
    text: "text-ui-meta",
    count: "text-ui-meta",
  },
  lg: {
    pill: "min-h-6 min-w-[1.5rem] px-2 py-0.5 gap-1",
    symbol: "h-4 w-4",
    text: "text-ui-meta",
    count: "text-ui-meta",
  },
};
export interface CounterBadgeProps {
  type: string;
  count: number;
  size?: CounterSize;
  className?: string;
}
export function CounterBadge({ type, count, size = "sm", className }: CounterBadgeProps) {
  if (count <= 0) return null;
  const cfg = counterBadgePresentation(type, count);
  const sz = SIZE_TOKENS[size];
  const tooltipText = `${count} ${cfg.title} counter${count !== 1 ? `s` : ""}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full font-bold leading-none",
            "select-none shadow-sm ring-1 ring-black/20",
            COUNTER_BG_CLASS[cfg.colorKey],
            "text-text-on-tinted",
            sz.pill,
            className,
          )}
        >
          {cfg.iconName ? (
            <GameIcon name={cfg.iconName} className={cn(sz.symbol, "fill-current")} />
          ) : (
            <span className={sz.text}>{cfg.label}</span>
          )}
          {cfg.displayCount != null && (
            <span className={cn(sz.count, "opacity-90")}>{cfg.displayCount}</span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
export interface CounterDisplayProps {
  counters: Record<string, number>;
  size?: CounterSize;
  className?: string;
}
export function CounterDisplay({ counters, size = "sm", className }: CounterDisplayProps) {
  const entries = Object.entries(counters).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-0.5", className)}>
      {entries.map(([type, count]) => (
        <CounterBadge key={type} type={type} count={count} size={size} />
      ))}
    </div>
  );
}
export interface CounterSummaryProps {
  counters: Record<string, number>;
  className?: string;
}
export function CounterSummary({ counters, className }: CounterSummaryProps) {
  const entries = Object.entries(counters)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-ui-meta", className)}>
      {entries.map(([type, count]) => {
        const cfg = getCounterConfig(type);
        return (
          <Tooltip key={type}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 cursor-help",
                  "bg-background/60 ring-1 ring-border/60",
                )}
              >
                <span className="font-bold text-foreground tabular-nums">{count}×</span>
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-full min-h-6 min-w-6 px-2 py-0.5",
                    "shadow-sm ring-1 ring-black/20 font-bold leading-none",
                    COUNTER_BG_CLASS[cfg.colorKey],
                    "text-text-on-tinted",
                  )}
                >
                  {cfg.iconName ? (
                    <GameIcon name={cfg.iconName} className="h-4 w-4 fill-current" />
                  ) : (
                    <span className="text-ui-meta">{cfg.label}</span>
                  )}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {count} {cfg.title} counter{count !== 1 ? "s" : ""}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

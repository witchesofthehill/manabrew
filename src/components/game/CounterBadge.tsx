import { cn } from "@/lib/utils";
import type { GameThemeColors } from "@/themes/gameTheme";
import { GameIcon, type GameIconName } from "./GameIcon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Counter configuration registry
// ---------------------------------------------------------------------------

type CounterColorKey = keyof GameThemeColors["counter"];

/** Visual configuration for a single counter type. */
interface CounterConfig {
  iconName?: GameIconName;
  label: string;
  /** Theme colour key for this counter's background tint. */
  colorKey: CounterColorKey;
  /** Full human-readable name used in tooltips. */
  title: string;
}

/**
 * Known counter types and their visual identity.
 *
 * Keys must match the `CounterType` variant names produced by the Rust engine
 * (derived from `{:?}` formatting, e.g. "P1P1", "M1M1", "Loyalty").
 *
 * Colour comes from `theme.counter.<colorKey>` — see `src/themes/default.ts`
 * for the canonical palette. To add a new counter type, add an entry here
 * and a matching `counter.<name>` key to the theme.
 */
const COUNTER_CONFIG: Record<string, CounterConfig> = {
  P1P1: { label: "+1/+1", colorKey: "p1p1", title: "+1/+1" },
  M1M1: { label: "−1/−1", colorKey: "m1m1", title: "−1/−1" },
  Loyalty: {
    iconName: "vibrating-shield",
    label: "Loyalty",
    colorKey: "loyalty",
    title: "Loyalty",
  },
  Charge: { iconName: "lightning-trio", label: "Charge", colorKey: "charge", title: "Charge" },
  Quest: { iconName: "scroll-quill", label: "Quest", colorKey: "quest", title: "Quest" },
  Study: { iconName: "book-aura", label: "Study", colorKey: "study", title: "Study" },
  Lore: { iconName: "spell-book", label: "Lore", colorKey: "lore", title: "Lore" },
  Age: { iconName: "hourglass", label: "Age", colorKey: "age", title: "Age" },
  Time: { iconName: "stopwatch", label: "Time", colorKey: "time", title: "Time" },
  Fade: { iconName: "ghost", label: "Fade", colorKey: "fade", title: "Fade" },
  Level: { iconName: "rank-3", label: "Level", colorKey: "level", title: "Level" },
  Storage: { iconName: "stack", label: "Storage", colorKey: "storage", title: "Storage" },
  Mining: { iconName: "mining", label: "Mining", colorKey: "mining", title: "Mining" },
  Brick: { iconName: "brick-wall", label: "Brick", colorKey: "brick", title: "Brick" },
  Depletion: {
    iconName: "battery-pack-alt",
    label: "Depletion",
    colorKey: "depletion",
    title: "Depletion",
  },
  Page: { iconName: "scroll-unfurled", label: "Page", colorKey: "page", title: "Page" },
  Shield: { iconName: "round-shield", label: "Shield", colorKey: "shield", title: "Shield" },
};

function getCounterConfig(type: string): CounterConfig {
  return (
    COUNTER_CONFIG[type] ?? {
      label: type.slice(0, 3),
      colorKey: "default",
      title: type,
    }
  );
}

/** Static `bg-counter-*` class per counter colour key — Tailwind JIT
 *  needs the full class name in source, so we can't string-build it. */
const COUNTER_BG_CLASS: Record<CounterColorKey, string> = {
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

// ---------------------------------------------------------------------------
// Size tokens
// ---------------------------------------------------------------------------

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
    pill: "h-5 min-w-[1.25rem] px-1.5 gap-0.5",
    symbol: "h-3.5 w-3.5",
    text: "text-[10px]",
    count: "text-[9px]",
  },
  lg: {
    pill: "h-6 min-w-[1.5rem] px-2 gap-1",
    symbol: "h-4 w-4",
    text: "text-xs",
    count: "text-[10px]",
  },
};

// ---------------------------------------------------------------------------
// CounterBadge — one badge per counter type
// ---------------------------------------------------------------------------

export interface CounterBadgeProps {
  type: string;
  count: number;
  size?: CounterSize;
  className?: string;
}

/**
 * Renders a single pill-shaped counter badge showing its symbol and, when
 * count > 1, the quantity.  Returns null for zero-count counters.
 */
export function CounterBadge({ type, count, size = "sm", className }: CounterBadgeProps) {
  if (count <= 0) return null;

  const cfg = getCounterConfig(type);
  const sz = SIZE_TOKENS[size];

  const tooltipText = `${count} ${cfg.title} counter${count !== 1 ? "s" : ""}`;

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
          {count > 1 && <span className={cn(sz.count, "opacity-90")}>{count}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// CounterDisplay — row of badges for all counters on a card
// ---------------------------------------------------------------------------

export interface CounterDisplayProps {
  /** Map of counter-type name → count, as received from the engine. */
  counters: Record<string, number>;
  size?: CounterSize;
  className?: string;
}

/**
 * Renders all non-zero counters for a card as a compact, wrapping row of
 * `CounterBadge` elements.  Returns null when there are no counters.
 */
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
    <div className={cn("flex flex-wrap items-center gap-1.5 text-sm", className)}>
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
                    "inline-flex items-center justify-center rounded-full h-6 min-w-6 px-2",
                    "shadow-sm ring-1 ring-black/20 font-bold leading-none",
                    COUNTER_BG_CLASS[cfg.colorKey],
                    "text-text-on-tinted",
                  )}
                >
                  {cfg.iconName ? (
                    <GameIcon name={cfg.iconName} className="h-4 w-4 fill-current" />
                  ) : (
                    <span className="text-xs">{cfg.label}</span>
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

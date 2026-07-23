import { useEffect, useId, useState, type CSSProperties } from "react";
import type { CardRailState } from "./cardRailState";
import { getCardRailNotchAttributes, getCardRailRootAttributes } from "./cardRailState";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { cn } from "@/lib/utils";

export const CARD_RAIL_WIDTH = "clamp(22px, 9cqw, 32px)";

const RAIL_TRANSITION =
  "transition-transform duration-[300ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none";

const RAIL_KIND_CLASSES: Record<CardRailState["kind"], string> = {
  saga: "border-counter-lore/40 bg-counter-lore/10",
  class: "border-counter-level/40 bg-counter-level/10",
};

const RAIL_MARKER_CLASSES: Record<CardRailState["kind"], string> = {
  saga: "bg-counter-lore/25 ring-1 ring-counter-lore/45",
  class: "bg-counter-level/25 ring-1 ring-counter-level/45",
};

const RAIL_ACTIVE_DOT_CLASSES: Record<CardRailState["kind"], string> = {
  saga: "bg-counter-lore",
  class: "bg-counter-level",
};

interface CardRailProps {
  state: CardRailState;
  className?: string;
  placement?: "overlay" | "inline";
}

type CardRailSnapshot = {
  state: CardRailState;
  signature: string;
};

export function CardRail({ state, className, placement = "overlay" }: CardRailProps) {
  const [previousSnapshot, setPreviousSnapshot] = useState<CardRailSnapshot | null>(null);
  const railInstanceId = useId();
  const signature = `${state.id}:${state.kind}:${state.max}:${state.current}`;
  const adjacent =
    previousSnapshot != null &&
    previousSnapshot.state.id === state.id &&
    previousSnapshot.state.kind === state.kind &&
    previousSnapshot.state.max === state.max &&
    previousSnapshot.state.current > 0 &&
    state.current > 0 &&
    Math.abs(previousSnapshot.state.current - state.current) === 1;
  const animate =
    previousSnapshot != null &&
    previousSnapshot.signature !== signature &&
    adjacent &&
    animationsEnabled();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreviousSnapshot({ state, signature });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [signature, state]);

  const railStyle =
    placement === "overlay" ? "absolute right-1 top-[14%] bottom-[9%]" : "relative h-full";

  return (
    <div
      {...getCardRailRootAttributes(state, railInstanceId)}
      className={cn(
        "pointer-events-none select-none shrink-0 w-[var(--card-rail-width)]",
        railStyle,
        className,
      )}
      aria-hidden="true"
      style={
        {
          ["--card-rail-width" as string]: CARD_RAIL_WIDTH,
          fontSize: "clamp(7px, 2.5cqw, 10px)",
        } as CSSProperties
      }
    >
      <div
        className={cn(
          "relative h-full overflow-hidden rounded-[0.85em] border shadow-sm",
          RAIL_KIND_CLASSES[state.kind],
        )}
      >
        {state.current > 0 && (
          <div
            className={cn(
              "absolute left-[0.18em] right-[0.18em] z-0 rounded-[0.7em]",
              RAIL_MARKER_CLASSES[state.kind],
              animate && RAIL_TRANSITION,
            )}
            style={{
              height: `calc(100% / ${state.max})`,
              transform: `translateY(calc(${Math.min(state.current, state.max) - 1} * 100%))`,
            }}
          />
        )}
        <div
          className="relative z-10 grid h-full"
          style={{ gridTemplateRows: `repeat(${state.max}, minmax(0, 1fr))` }}
        >
          {state.notches.map((notch) => (
            <div
              key={notch.id}
              {...getCardRailNotchAttributes(notch, railInstanceId)}
              className={cn(
                "relative flex items-center gap-[0.2em] overflow-hidden px-[0.28em] leading-none",
                notch.active ? "text-text-on-tinted" : "text-foreground/85",
              )}
            >
              <span
                className={cn(
                  "absolute inset-x-[0.18em] top-1/2 h-px -translate-y-1/2 rounded-full",
                  notch.active ? "bg-text-on-tinted/70" : "bg-border/60",
                )}
              />
              <span className="relative z-10 font-bold tabular-nums">{notch.label}</span>
              <span
                className={cn(
                  "relative z-10 ml-auto h-[0.42em] w-[0.42em] rounded-full shadow-sm",
                  notch.active ? RAIL_ACTIVE_DOT_CLASSES[state.kind] : "bg-border/70",
                )}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

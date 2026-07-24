import { useEffect, useId, useState } from "react";
import type { CSSProperties } from "react";
import type { CardRailState } from "./cardRailState";
import { getCardRailNotchAttributes, getCardRailRootAttributes } from "./cardRailState";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { cn } from "@/lib/utils";

export const CARD_RAIL_WIDTH = "clamp(14px, 7cqw, 22px)";

const RAIL_TRANSITION =
  "transition-transform duration-[300ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none";

const RAIL_KIND_CLASSES: Record<CardRailState["kind"], string> = {
  saga: "border-counter-lore/70",
  class: "border-counter-level/70",
};

const RAIL_ACCENT_CLASSES: Record<CardRailState["kind"], string> = {
  saga: "bg-counter-lore",
  class: "bg-counter-level",
};

const RAIL_ACCENT_TEXT_CLASSES: Record<CardRailState["kind"], string> = {
  saga: "text-counter-lore",
  class: "text-counter-level",
};

interface CardRailProps {
  state: CardRailState;
  className?: string;
}

type CardRailSnapshot = {
  state: CardRailState;
  signature: string;
};

export function CardRail({ state, className }: CardRailProps) {
  const [previousSnapshot, setPreviousSnapshot] = useState<CardRailSnapshot | null>(null);
  const railInstanceId = useId();
  const signature = `${state.id}:${state.kind}:${state.max}:${state.current}`;
  const adjacent =
    previousSnapshot != null &&
    previousSnapshot.state.id === state.id &&
    previousSnapshot.state.kind === state.kind &&
    previousSnapshot.state.max === state.max &&
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

  const connectorInset = 50 / state.max;
  const connectorHeight = 100 - connectorInset * 2;
  const progressHeight =
    state.current > 1 && state.max > 1
      ? (connectorHeight * (state.current - 1)) / (state.max - 1)
      : 0;

  return (
    <div
      {...getCardRailRootAttributes(state, railInstanceId)}
      className={cn(
        "pointer-events-none absolute right-1 top-[14%] bottom-[9%] w-[var(--card-rail-width)] select-none text-[clamp(6px,2.2cqw,9px)]",
        className,
      )}
      aria-hidden="true"
      style={{ ["--card-rail-width" as string]: CARD_RAIL_WIDTH } as CSSProperties}
    >
      <div
        className={cn(
          "relative h-full overflow-hidden rounded-full border bg-canvas-shadow/80 shadow-sm",
          RAIL_KIND_CLASSES[state.kind],
        )}
      >
        <span
          className="absolute left-1/2 w-px -translate-x-1/2 bg-text-muted/50"
          style={{ top: `${connectorInset}%`, height: `${connectorHeight}%` }}
        />
        <span
          className={cn(
            "absolute left-1/2 w-0.5 -translate-x-1/2 rounded-full",
            RAIL_ACCENT_CLASSES[state.kind],
          )}
          style={{ top: `${connectorInset}%`, height: `${progressHeight}%` }}
        />
        <div
          className="relative z-10 grid h-full"
          style={{ gridTemplateRows: `repeat(${state.max}, minmax(0, 1fr))` }}
        >
          {state.notches.map((notch) => (
            <div
              key={notch.id}
              {...getCardRailNotchAttributes(notch, railInstanceId)}
              className="flex items-center justify-center"
            >
              <span
                className={cn(
                  "flex h-[1.8em] w-[1.8em] items-center justify-center rounded-full border text-[0.8em] font-black leading-none tabular-nums",
                  notch.active
                    ? cn(
                        RAIL_ACCENT_CLASSES[state.kind],
                        "border-text-on-tinted text-text-on-tinted ring-1 ring-canvas-shadow",
                        animate && "scale-125",
                        RAIL_TRANSITION,
                      )
                    : notch.reached
                      ? cn(
                          RAIL_KIND_CLASSES[state.kind],
                          RAIL_ACCENT_TEXT_CLASSES[state.kind],
                          "bg-canvas-shadow",
                        )
                      : "border-text-muted/70 bg-canvas-shadow text-text-muted",
                )}
              >
                {notch.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

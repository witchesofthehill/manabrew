import type { CSSProperties } from "react";
import type { CardDto } from "@/protocol/game";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { deriveCardChoiceIndicators } from "./game.utils";
import { cn } from "@/lib/utils";

interface CardChoiceIndicatorsProps {
  card: Pick<CardDto, "choices">;
  expanded?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function CardChoiceIndicators({
  card,
  expanded = false,
  className,
  style,
}: CardChoiceIndicatorsProps) {
  const indicators = deriveCardChoiceIndicators(card);
  if (indicators.length === 0) return null;

  const visible = expanded ? indicators : indicators.slice(0, 1);
  const hidden = indicators.length - visible.length;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-1 pointer-events-none",
        className,
      )}
      style={style}
    >
      {visible.map((indicator) => (
        <span
          key={indicator.key}
          title={indicator.description}
          className={cn(
            "inline-flex min-w-0 items-center justify-center rounded font-bold shadow-md",
            "bg-card-status-choice/95 text-text-on-tinted",
            expanded
              ? "gap-1.5 px-2 py-1 text-[11px]"
              : "max-w-full px-1.5 py-0.5 text-[7px] leading-none",
          )}
        >
          {expanded && (
            <span className="whitespace-nowrap">
              {indicator.kind === "color"
                ? "Chosen color"
                : indicator.description.slice(0, indicator.description.indexOf(":"))}
            </span>
          )}
          {indicator.kind === "color" ? (
            <ManaSymbols
              cost={indicator.colors.map((color) => `{${color}}`).join("")}
              size="em"
              className={cn("!mx-0", expanded ? "text-base" : "text-[10px]")}
            />
          ) : (
            <span className={cn("truncate", expanded && "max-w-64")}>{indicator.label}</span>
          )}
        </span>
      ))}
      {hidden > 0 && (
        <span className="rounded bg-card-status-choice/95 px-1 py-0.5 text-[7px] font-bold leading-none text-text-on-tinted shadow-md">
          +{hidden}
        </span>
      )}
    </div>
  );
}

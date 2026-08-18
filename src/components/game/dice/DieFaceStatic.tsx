import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { getDiePoints } from "./dieShapes";

const SIZE_CLASSES = {
  sm: "w-10 h-10 text-base",
  md: "w-14 h-14 text-xl",
  lg: "w-16 h-16 text-2xl",
} as const;

type Size = keyof typeof SIZE_CLASSES;

interface DieFaceStaticProps {
  sides: number;
  value: number;
  size?: Size;
  muted?: boolean;
  selected?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  /**
   * Optional theme-token color (CSS color string). When supplied,
   * tints the die's silhouette and numeral so it can be associated
   * with a specific player.
   */
  accentColor?: string;
  className?: string;
}

export function DieFaceStatic({
  sides,
  value,
  size = "md",
  muted,
  selected,
  onClick,
  ariaLabel,
  accentColor,
  className,
}: DieFaceStaticProps) {
  const Element = onClick ? "button" : "div";
  const points = getDiePoints(sides);
  const wrapperStyle = buildAccentVars(accentColor);

  return (
    <Element
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={ariaLabel ?? `Die: ${value}`}
      className={cn(
        "relative flex items-center justify-center select-none rounded-md transition-all",
        SIZE_CLASSES[size],
        onClick && "cursor-pointer hover:[--die-border:var(--primary)]",
        selected && "ring-2 ring-primary/40 [--die-border:var(--primary)]",
        muted && "opacity-40",
        className,
      )}
      style={wrapperStyle}
      data-die-sides={sides}
      data-die-value={value}
    >
      <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible" aria-hidden="true">
        <polygon
          points={points}
          style={{ fill: "var(--die-bg)", stroke: "var(--die-border)" }}
          strokeWidth={5}
          strokeLinejoin="round"
        />
        <text
          x={50}
          y={50}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fill: "var(--die-fg)" }}
          fontWeight={600}
          fontSize={36}
        >
          {value}
        </text>
      </svg>
    </Element>
  );
}

function buildAccentVars(accentColor?: string): CSSProperties {
  if (!accentColor) {
    return {
      ["--die-bg" as string]: "var(--card)",
      ["--die-border" as string]: "var(--border)",
      ["--die-fg" as string]: "var(--foreground)",
    };
  }
  return {
    ["--die-bg" as string]: `color-mix(in srgb, ${accentColor} 14%, var(--card))`,
    ["--die-border" as string]: accentColor,
    ["--die-fg" as string]: `color-mix(in srgb, ${accentColor} 80%, var(--foreground))`,
  };
}

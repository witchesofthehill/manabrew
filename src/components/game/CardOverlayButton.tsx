import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";

type OverlayVariant =
  | "tap"
  | "untap"
  | "selectable"
  | "selectable-hostile"
  | "pending"
  | "attacking";

interface CardOverlayButtonProps {
  variant: OverlayVariant;
  onClick: () => void;
  title?: string;
  label?: string;
}

export function CardOverlayButton({ variant, onClick, title, label }: CardOverlayButtonProps) {
  const themeColors = useTheme().gameTheme;

  const variantColorMap: Record<OverlayVariant, string> = {
    tap: themeColors.cardRing,
    untap: themeColors.promptAction.cancel,
    selectable: themeColors.cardRing,
    "selectable-hostile": themeColors.arrow.hostileTarget,
    pending: themeColors.promptAction.passAction,
    attacking: themeColors.promptAction.attackAction,
  };

  const baseColor = variantColorMap[variant];
  const buttonStyle: CSSProperties = {
    backgroundColor: withAlpha(baseColor, 0.2),
    borderColor: baseColor,
  };
  const labelStyle: CSSProperties = {
    backgroundColor: withAlpha(baseColor, 0.92),
    color: themeColors.textOnTinted,
  };

  return (
    <button
      className={cn(
        "absolute inset-0 z-20 rounded-lg opacity-0 group-hover:opacity-100 border-2 transition-opacity",
        label && "flex items-end justify-center pb-1",
      )}
      style={buttonStyle}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      title={title}
    >
      {label && (
        <span className="text-[9px] font-bold px-1 rounded leading-none" style={labelStyle}>
          {label}
        </span>
      )}
    </button>
  );
}

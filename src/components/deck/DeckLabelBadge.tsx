import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import type { DeckLabel } from "@/protocol/deck";

/** Return the theme's shadow (dark) or neutral (light) colour depending on
 *  which produces better contrast against the supplied hex background. */
function getContrastColor(hex: string, darkInk: string, lightInk: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? darkInk : lightInk;
}

type Size = "sm" | "md";

const SIZE_CLASSES: Record<Size, string> = {
  sm: "text-[8px] px-1 py-0",
  md: "text-[10px] px-1.5 py-0.5",
};

interface DeckLabelBadgeProps {
  label: DeckLabel;
  size?: Size;
  className?: string;
}

export function DeckLabelBadge({ label, size = "sm", className }: DeckLabelBadgeProps) {
  const themeColors = useTheme().gameTheme;
  return (
    <span
      className={cn("rounded-full font-medium border leading-tight", SIZE_CLASSES[size], className)}
      style={
        label.color
          ? {
              backgroundColor: label.color,
              color: getContrastColor(
                label.color,
                themeColors.canvas.shadow,
                themeColors.canvas.neutral,
              ),
              borderColor: label.color,
            }
          : {
              backgroundColor: "var(--muted)",
              color: "var(--muted-foreground)",
              borderColor: "var(--border)",
            }
      }
    >
      {label.name}
    </span>
  );
}

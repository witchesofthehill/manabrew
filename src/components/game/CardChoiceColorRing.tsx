import type { CardDto } from "@/protocol/game";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { cn } from "@/lib/utils";
import { firstChosenColor } from "./game.utils";

interface CardChoiceColorRingProps {
  card: Pick<CardDto, "choices">;
  className?: string;
  strokeWidth?: string;
}

export function CardChoiceColorRing({
  card,
  className,
  strokeWidth = "max(2px, 1cqw)",
}: CardChoiceColorRingProps) {
  const color = firstChosenColor(card);
  const theme = useTheme().gameTheme;
  if (!color) return null;

  return (
    <div
      className={cn("absolute inset-0 z-10 rounded-[inherit] pointer-events-none", className)}
      style={{ boxShadow: `inset 0 0 0 ${strokeWidth} ${withAlpha(theme.mana[color], 0.95)}` }}
    />
  );
}

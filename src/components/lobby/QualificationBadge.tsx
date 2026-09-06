import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GameIcon, type GameIconKey } from "@/components/companion/GameIcon";
import { cn } from "@/lib/utils";

const QUALIFICATION_BADGES: Record<string, { icon: GameIconKey; label: string; color: string }> = {
  maintainer: { icon: "witch-flight", label: "Maintainer", color: "text-format-badge-amber" },
};

interface QualificationBadgeProps {
  qualification: string | undefined;
  className?: string;
}

export function QualificationBadge({ qualification, className }: QualificationBadgeProps) {
  const badge = qualification ? QUALIFICATION_BADGES[qualification] : undefined;
  if (!badge) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("flex shrink-0", badge.color)}>
          <GameIcon icon={badge.icon} className={cn("h-3.5 w-3.5", className)} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{badge.label}</TooltipContent>
    </Tooltip>
  );
}

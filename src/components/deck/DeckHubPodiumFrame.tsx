import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DeckHubPodiumFrameProps {
  rank: number;
  children: ReactNode;
  className?: string;
}

export function DeckHubPodiumFrame({ rank, children, className }: DeckHubPodiumFrameProps) {
  return (
    <div className={cn("podium-frame relative", `podium-rank-${rank}`, className)}>
      {rank <= 3 && <span className="podium-aura" aria-hidden="true" />}
      {rank === 1 && (
        <span className="podium-sparkles" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      )}
      <div className="relative z-10 min-h-0 flex-1">{children}</div>
    </div>
  );
}

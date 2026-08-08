import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DeckHubPodiumFrameProps {
  rank: number;
  children: ReactNode;
  prominent?: boolean;
}

export function DeckHubPodiumFrame({ rank, children, prominent = false }: DeckHubPodiumFrameProps) {
  return (
    <div className={cn("podium-frame relative pt-8", `podium-rank-${rank}`)}>
      {rank <= 3 && <span className="podium-aura" aria-hidden="true" />}
      {rank === 1 && (
        <span className="podium-sparkles" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      )}
      <span
        className={cn(
          "absolute left-0 top-0 z-30 rounded-full border border-primary/30 bg-background/95 px-2 py-0.5 font-serif font-semibold text-primary shadow-sm",
          prominent && rank === 1 ? "text-xl" : "text-sm",
        )}
      >
        #{rank}
      </span>
      <div className="relative z-10">{children}</div>
    </div>
  );
}

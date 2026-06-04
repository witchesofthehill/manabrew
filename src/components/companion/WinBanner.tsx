import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCompanionStore } from "@/stores/useCompanionStore";
import { COMPANION_ACCENT_COLORS } from "@/stores/useCompanionStore.constants";
import type { CompanionPlayer, CompanionSession } from "@/stores/useCompanionStore.types";
import { GameIcon } from "./GameIcon";

interface WinBannerProps {
  session: CompanionSession;
}

export function WinBanner({ session }: WinBannerProps) {
  const living = session.players.filter((p) => !p.isDead);
  const winner = session.players.length > 1 && living.length === 1 ? living[0]! : null;
  if (!winner) return null;
  // Keying by id + history length lets the banner re-show if the user
  // revives the winner (history grows) and then eliminates them again,
  // even when the same player wins both times in a single session.
  return <WinBannerInner key={`${winner.id}-${session.history.length}`} winner={winner} />;
}

function WinBannerInner({ winner }: { winner: CompanionPlayer }) {
  const endSession = useCompanionStore((s) => s.endSession);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const accent = COMPANION_ACCENT_COLORS[winner.accentKey];
  return (
    <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm">
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-card px-6 py-5 text-center shadow-2xl">
        <div
          className="grid size-14 place-items-center rounded-full text-white"
          style={{ backgroundColor: accent }}
        >
          <GameIcon icon="trophy-cup" className="size-8" />
        </div>
        <div>
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Last standing</p>
          <h2 className="text-2xl font-bold">{winner.name}</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDismissed(true)}>
            Keep playing
          </Button>
          <Button onClick={() => endSession(winner.id)}>Archive game</Button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { configureGauntlet, type LimitedBestOf } from "@/lib/gauntletReturn";
import { useLimitedStore } from "@/stores/useLimitedStore";
import type { DraftCard } from "@/types/limited";

interface LimitedPlayActionProps {
  sessionId: string;
  kind: "draft" | "sealed";
  rounds: number;
  deck: { main: DraftCard[]; sideboard: DraftCard[] };
}

export function LimitedPlayAction({ sessionId, kind, rounds, deck }: LimitedPlayActionProps) {
  const navigate = useNavigate();
  const [bestOf, setBestOf] = useState<LimitedBestOf>(3);
  const isStarting = useLimitedStore((state) => state.isStarting);
  const startSealed = useLimitedStore((state) => state.startGauntletFromSealed);
  const startDraft = useLimitedStore((state) => state.startGauntletFromDraft);
  const missing = Math.max(0, 40 - deck.main.length);
  const play = async () => {
    const start = kind === "sealed" ? startSealed : startDraft;
    try {
      const state = await start(sessionId, rounds, deck.main, deck.sideboard);
      await configureGauntlet(state, sessionId, bestOf);
      navigate(`/gauntlet/${state.gauntletId}`, { state: { launch: true } });
    } catch {
      return;
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <AppSelect
        aria-label="Match length"
        value={bestOf}
        onValueChange={(value) => setBestOf(Number(value) as LimitedBestOf)}
        disabled={isStarting}
      >
        <AppSelectOption value="1">Best of one</AppSelectOption>
        <AppSelectOption value="3">Best of three</AppSelectOption>
      </AppSelect>
      <Button
        variant="primary"
        onClick={() => void play()}
        disabled={isStarting || missing > 0 || rounds === 0}
      >
        {isStarting
          ? "Preparing match…"
          : missing > 0
            ? `Add ${missing} more card${missing === 1 ? "" : "s"}`
            : "Play vs AI"}
      </Button>
    </div>
  );
}

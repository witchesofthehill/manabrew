import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import { buildDeck, useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { useMultiplayerLimitedStore } from "@/stores/useMultiplayerLimitedStore";
import { gauntletProgress } from "@/lib/gauntletReturn";
import type { BuildSession } from "@/components/limited/useLimitedBuildStore";

interface LimitedReviewBuildsProps {
  sessionId: string;
  build: BuildSession;
  previewPortalTarget: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
}

export function LimitedReviewBuilds({
  sessionId,
  build,
  previewPortalTarget,
  onOpenChange,
}: LimitedReviewBuildsProps) {
  const [selectedId, setSelectedId] = useState("current");
  const location = useLocation();
  const selected = build.builds.find((item) => item.id === selectedId);
  const deck = buildDeck({ pool: build.pool, allocation: selected ?? build.allocation });
  const soloActive = useLimitedStore(
    (state) =>
      state.activeDraft?.sessionId === sessionId ||
      state.activeWinston?.sessionId === sessionId ||
      state.activeSealed?.sessionId === sessionId ||
      Boolean(
        state.activeGauntlet && gauntletProgress(state.activeGauntlet).sessionKey === sessionId,
      ),
  );
  const multiplayerActive = useMultiplayerLimitedStore(
    (state) => state.sessionId === sessionId && state.phase === "building",
  );
  const builderVisible =
    location.pathname.startsWith("/draft/") ||
    location.pathname.startsWith("/winston/") ||
    location.pathname.startsWith("/sealed/") ||
    location.pathname.startsWith("/gauntlet/");
  const canOpen = Boolean(
    selected &&
    builderVisible &&
    (soloActive || multiplayerActive) &&
    useLimitedBuildStore.getState().sessions[sessionId],
  );
  return (
    <section className="grid gap-3 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Named builds</h3>
        <AppSelect
          value={selectedId}
          onValueChange={setSelectedId}
          aria-label="Review a named build"
        >
          <AppSelectOption value="current">Current allocation</AppSelectOption>
          {build.builds.map((item) => (
            <AppSelectOption key={item.id} value={item.id}>
              {item.name}
            </AppSelectOption>
          ))}
        </AppSelect>
        <Button
          variant="outline"
          size="sm"
          disabled={!canOpen}
          onClick={() => {
            if (!selected) return;
            useLimitedBuildStore.getState().loadBuild(sessionId, selected.id);
            onOpenChange(false);
          }}
        >
          Open in builder
        </Button>
        <span className="text-xs text-muted-foreground">
          Mainboard {deck.main.length} · Sideboard {deck.sideboard.length}
        </span>
      </div>
      <LimitedCardCanvas
        cards={deck.main}
        className="h-52"
        previewPortalTarget={previewPortalTarget}
        emptyMessage="No Mainboard cards in this build."
      />
    </section>
  );
}

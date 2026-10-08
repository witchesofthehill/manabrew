import { useMemo, useState } from "react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LimitedHandSampleWorkspace } from "@/components/limited/LimitedHandSampleWorkspace";
import { buildDeck } from "@/components/limited/useLimitedBuildStore";
import type { BuildSession } from "@/components/limited/useLimitedBuildStore";
import type { LimitedHandPosition } from "@/lib/limitedHand.types";
import type { DraftCard } from "@/types/limited";

interface LimitedHandTesterProps {
  sessionKey: string;
  session: BuildSession;
  deck: { main: DraftCard[]; sideboard: DraftCard[] };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LimitedHandTester({
  sessionKey,
  session,
  deck,
  open,
  onOpenChange,
}: LimitedHandTesterProps) {
  const [buildId, setBuildId] = useState("current");
  const [position, setPosition] = useState<LimitedHandPosition>("play");
  const [previewPortalTarget, setPreviewPortalTarget] = useState<HTMLDivElement | null>(null);
  const builds = useMemo(
    () => [
      { id: "current", name: "Current Mainboard", cards: deck.main },
      ...session.builds.map((build) => ({
        id: `saved:${build.id}`,
        name: build.name,
        cards: buildDeck({ pool: session.pool, allocation: build }).main,
      })),
    ],
    [deck.main, session.pool, session.builds],
  );
  const selected = builds.find((build) => build.id === buildId) ?? builds[0];
  const sampleKey = JSON.stringify([sessionKey, selected.id, selected.cards, position]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={setPreviewPortalTarget}
        className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto overscroll-contain"
      >
        <DialogHeader>
          <DialogTitle>Opening hand tester</DialogTitle>
          <DialogDescription>
            Practice with your Mainboard or a named build. This does not change your deck, readiness
            or undo history.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">Build to sample</span>
            <AppSelect aria-label="Build to sample" value={selected.id} onValueChange={setBuildId}>
              {builds.map((build) => (
                <AppSelectOption key={build.id} value={build.id}>
                  {build.name} · {build.cards.length} cards
                </AppSelectOption>
              ))}
            </AppSelect>
          </div>
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">Starting position</span>
            <AppSelect
              aria-label="Starting position"
              value={position}
              onValueChange={(value) => setPosition(value === "draw" ? "draw" : "play")}
            >
              <AppSelectOption value="play">On the play</AppSelectOption>
              <AppSelectOption value="draw">On the draw</AppSelectOption>
            </AppSelect>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          1v1 Limited uses the London mulligan, with no free first mulligan. Each mulligan
          reshuffles the entire build and draws seven, or all cards in a smaller practice build.
          Switching build or starting position deals a new opening hand.
        </p>
        {open && (
          <LimitedHandSampleWorkspace
            key={sampleKey}
            cards={selected.cards}
            position={position}
            previewPortalTarget={previewPortalTarget}
          />
        )}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

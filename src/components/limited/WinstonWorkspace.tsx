import { useState } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsDesktop, useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import { cn } from "@/lib/utils";
import { LimitedReferenceButton } from "@/components/limited/LimitedReferenceButton";
import type { LimitedReferenceFormat } from "@/components/limited/LimitedSetReference";
import type { WinstonState } from "@/types/limited";

interface WinstonWorkspaceProps {
  activeWinston: WinstonState;
  activeIdx: number;
  onTake: () => void;
  onPass: () => void;
  referenceFormat?: LimitedReferenceFormat;
}

export function WinstonWorkspace({
  activeWinston,
  activeIdx,
  onTake,
  onPass,
  referenceFormat,
}: WinstonWorkspaceProps) {
  const desktop = useIsDesktop();
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const showBoth = desktop && !(shortScreen && isTouch);
  const [tab, setTab] = useState<"piles" | "deck">("piles");
  const cardSize = useLimitedBuildStore(
    (state) =>
      state.sessions[activeWinston.sessionId]?.cardSize ?? state.displayPreferences.cardSize,
  );
  const activePile = activeWinston.piles[activeIdx] ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {!showBoth && (
        <div className="flex gap-2" role="tablist" aria-label="Winston workspace">
          <Button
            role="tab"
            aria-selected={tab === "piles"}
            variant={tab === "piles" ? "selected" : "ghost"}
            size="sm"
            onClick={() => setTab("piles")}
          >
            Piles
          </Button>
          <Button
            role="tab"
            aria-selected={tab === "deck"}
            variant={tab === "deck" ? "selected" : "ghost"}
            size="sm"
            onClick={() => setTab("deck")}
          >
            Build · {activeWinston.pickedPile.length}
          </Button>
        </div>
      )}
      <div
        className={cn(
          "grid min-h-0 flex-1 gap-3 overflow-hidden",
          showBoth && "grid-rows-[minmax(0,min(42%,24rem))_minmax(0,1fr)]",
        )}
      >
        {(showBoth || tab === "piles") && (
          <section className="flex min-h-0 flex-col overflow-hidden">
            <header className="flex shrink-0 self-center items-center justify-center gap-2 rounded bg-card/70 px-2 py-1">
              <h2 className="font-serif text-lg">Pile {activeIdx + 1}</h2>
              <span className="text-xs text-muted-foreground">{activePile.length} cards</span>
              <LimitedReferenceButton
                cards={activeWinston.pickedPile.length ? activeWinston.pickedPile : activePile}
                format={referenceFormat}
              />
            </header>
            <LimitedCardCanvas
              cards={activePile}
              cardSize={cardSize}
              presentation="spread"
              arrivalKey={`${activeWinston.sessionId}:${activeIdx}:${activePile.map((card) => card.id).join(",")}`}
              className="min-h-0 flex-1"
            />
            <footer className="flex shrink-0 flex-wrap items-center justify-center gap-3 px-3 py-1">
              {activeWinston.awaitingHuman && (
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onTake}
                    disabled={activePile.length === 0}
                  >
                    Take pile
                  </Button>
                  <Button variant="outline" size="sm" onClick={onPass}>
                    Pass
                  </Button>
                </div>
              )}
              {activeWinston.piles.map((pile, index) =>
                index === activeIdx ? null : (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded bg-card/70 px-3 py-2 text-xs text-muted-foreground"
                  >
                    <Layers className="size-4" aria-hidden="true" />
                    <span>
                      Pile {index + 1} · {pile.length} face down
                    </span>
                  </div>
                ),
              )}
            </footer>
          </section>
        )}
        {(showBoth || tab === "deck") && (
          <LimitedDeckBuilder
            key={activeWinston.sessionId}
            sessionKey={activeWinston.sessionId}
            pool={activeWinston.pickedPile}
            defaultDeckName="Winston Draft Deck"
            format="draft"
            showUtilities={false}
            referenceFormat={referenceFormat}
          />
        )}
      </div>
    </div>
  );
}

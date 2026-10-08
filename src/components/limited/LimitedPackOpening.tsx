import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { LimitedCardCanvas } from "@/components/limited/LimitedCardCanvas";
import { LimitedBoosterTable } from "@/components/limited/LimitedBoosterTable";
import { useLimitedPackOpening } from "@/components/limited/useLimitedPackOpening";
import { useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import { Button } from "@/components/ui/button";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import { cn } from "@/lib/utils";
import type { SealedPool } from "@/types/limited";

const RARITY_ORDER: Record<string, number> = { mythic: 0, rare: 1, uncommon: 2, common: 3 };
const NO_OPENING_PACKS: readonly string[] = [];
export function LimitedPackOpening({
  sessionKey,
  packs,
  onComplete,
}: {
  sessionKey: string;
  packs: SealedPool["packs"];
  onComplete: () => void;
}) {
  const compact = useIsMobileGame();
  const [viewPool, setViewPool] = useState(false);
  const cardSize = useLimitedBuildStore(
    (state) => state.sessions[sessionKey]?.cardSize ?? state.displayPreferences.cardSize,
  );
  const sets = useScryfallStore((state) => state.sets);
  const bucket = useScryfallStore((state) => state.cards);
  const {
    openedIds,
    openedCount,
    unopenedPacks,
    activePack,
    preparing,
    poolCards,
    openingCardIds,
    revealing,
    imageError,
    tearDirection,
    openingPackets,
    arrival,
    reveal,
    finishReveal,
    complete,
  } = useLimitedPackOpening(sessionKey, packs, onComplete);
  const latestCards = useMemo(() => {
    const ids = new Set(openingCardIds);
    return poolCards
      .filter((card) => ids.has(card.id))
      .map((card) => ({
        card,
        rank:
          RARITY_ORDER[
            peekCard(bucket, {
              name: card.name,
              setCode: card.setCode,
              collectorNumber: card.cardNumber,
            })?.rarity ?? ""
          ] ?? 4,
      }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ card }) => card);
  }, [poolCards, openingCardIds, bucket]);
  const openingIds = useMemo(
    () => (revealing ? openingPackets.map((packet) => packet.packId) : NO_OPENING_PACKS),
    [revealing, openingPackets],
  );
  const acquiredCount = packs
    .filter((pack) => openedIds.includes(pack.id))
    .reduce((count, pack) => count + pack.cards.length, 0);
  const allOpened = unopenedPacks.length === 0 && !revealing && !preparing;
  const showingPool = allOpened || viewPool;
  const setCode = packs.every((pack) => pack.setCode === packs[0]?.setCode)
    ? packs[0]?.setCode
    : undefined;
  const setName =
    sets.find((set) => set.code === setCode?.toLowerCase())?.name ??
    setCode?.toUpperCase() ??
    "Sealed";
  return (
    <section
      aria-label="Open sealed boosters"
      aria-busy={preparing || revealing}
      className={cn("flex h-full min-h-0 flex-col overflow-hidden", compact ? "gap-2" : "gap-4")}
    >
      <header className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl sm:text-2xl">{setName}</h2>
          <p role="status" aria-live="polite" className="mt-0.5 text-xs text-muted-foreground">
            {preparing
              ? "Loading cards…"
              : revealing
                ? "Opening boosters…"
                : `${openedCount} of ${packs.length} packs opened`}
          </p>
        </div>
        {!allOpened && (
          <Button variant="ghost" size="sm" onClick={complete}>
            Skip opening
          </Button>
        )}
      </header>
      {imageError && (
        <p role="status" className="text-sm text-muted-foreground">
          Some card images could not load. Card names remain available.
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-3 [@media(orientation:landscape)_and_(max-height:600px)]:flex-row">
        {unopenedPacks.length > 0 && (
          <LimitedBoosterTable
            packs={packs}
            openedIds={openedIds}
            openingIds={openingIds}
            disabled={preparing || revealing}
            compact={latestCards.length > 0}
            className={cn(
              latestCards.length > 0 &&
                "[@media(orientation:landscape)_and_(max-height:600px)]:w-40 [@media(orientation:landscape)_and_(max-height:600px)]:gap-1",
            )}
            onOpen={(ids, direction, capture) => {
              setViewPool(false);
              void reveal(ids, direction, capture);
            }}
          />
        )}
        {latestCards.length > 0 && (
          <section
            aria-label={showingPool ? "Opened card pool" : "Latest booster cards"}
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-1"
          >
            <div className="flex shrink-0 items-baseline justify-center gap-2">
              <h3 className="font-serif text-lg">
                {showingPool
                  ? "Pool"
                  : activePack
                    ? `Booster ${packs.indexOf(activePack) + 1}`
                    : "Latest boosters"}
              </h3>
              <span className="text-xs text-muted-foreground">
                {showingPool ? poolCards.length : latestCards.length} cards
              </span>
            </div>
            <p className="shrink-0 text-center text-xs text-muted-foreground sm:hidden">
              Scroll to browse cards
            </p>
            <LimitedCardCanvas
              cards={showingPool ? poolCards : latestCards}
              cardSize={cardSize}
              presentation="grid"
              arrivalKey={`${sessionKey}:${arrival}`}
              opening={revealing}
              openingPackets={openingPackets}
              openingCardIds={openingCardIds}
              openingTearDirection={tearDirection}
              onOpeningComplete={finishReveal}
              className="min-h-0 w-full flex-1"
            />
          </section>
        )}
      </div>
      {openedCount > 0 && (
        <footer
          className={cn(
            "flex shrink-0 items-center gap-3 border-t border-border/50 pt-2",
            allOpened ? "justify-end" : "justify-between",
          )}
        >
          {!allOpened && (
            <Button
              variant={showingPool ? "selected" : "outline"}
              size="sm"
              disabled={preparing || revealing}
              aria-expanded={showingPool}
              onClick={() => setViewPool(!viewPool)}
            >
              {showingPool ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              Pool · {acquiredCount} cards
            </Button>
          )}
          {allOpened && (
            <Button variant="primary" onClick={complete}>
              Build deck
            </Button>
          )}
        </footer>
      )}
    </section>
  );
}

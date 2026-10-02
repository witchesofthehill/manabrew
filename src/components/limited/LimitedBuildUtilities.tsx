import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DeckStats } from "@/components/editor/DeckStats";
import { TokenSection } from "@/components/editor/TokenSection";
import { CARD_WIDTH_MAP, DEFAULT_CARD_SIZE } from "@/components/editor/deckBuilder.utils";
import { CardHoverPreview } from "@/components/game/CardHoverPreview";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useDerivedTokens } from "@/hooks/useDerivedTokens";
import { resolveDeckCards } from "@/lib/limited.utils";
import { deckCardToPreviewDto } from "@/lib/scryfall.utils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { Deck } from "@/protocol/deck";
import type { DraftCard } from "@/types/limited";

interface LimitedBuildUtilitiesProps {
  deck: { main: DraftCard[]; sideboard: DraftCard[] };
  cardSize: number;
  activeManaValue: number | null;
  onManaValueChange: (bucket: number | null) => void;
}

const EMPTY_DECK: Deck = { name: "Limited build", cards: [], sideboard: [] };

export function LimitedBuildUtilities({
  deck,
  cardSize,
  activeManaValue,
  onManaValueChange,
}: LimitedBuildUtilitiesProps) {
  const [manaOpen, setManaOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const locale = useScryfallStore((state) => state.locale);
  const [resolution, setResolution] = useState<{
    main: DraftCard[];
    sideboard: DraftCard[];
    locale: string;
    deck: Deck | null;
    error: string | null;
  } | null>(null);
  const { main, sideboard } = deck;
  useEffect(() => {
    let cancelled = false;
    void Promise.all([resolveDeckCards(main), resolveDeckCards(sideboard)])
      .then(([cards, resolvedSideboard]) => {
        if (!cancelled)
          setResolution({
            main,
            sideboard,
            locale,
            deck: { name: "Limited build", cards, sideboard: resolvedSideboard },
            error: null,
          });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResolution({
            main,
            sideboard,
            locale,
            deck: null,
            error: error instanceof Error ? error.message : "Card details are unavailable.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [main, sideboard, locale]);
  const current =
    resolution?.main === main && resolution.sideboard === sideboard && resolution.locale === locale
      ? resolution
      : null;
  const resolvedDeck = current?.deck ?? EMPTY_DECK;
  const tokens = useDerivedTokens(resolvedDeck);
  const tokenCardSize = Object.keys(CARD_WIDTH_MAP).reduce((closest, key) => {
    const size = Number(key);
    return Math.abs(CARD_WIDTH_MAP[size] - cardSize) < Math.abs(CARD_WIDTH_MAP[closest] - cardSize)
      ? size
      : closest;
  }, DEFAULT_CARD_SIZE);
  const preview = useCardPreview([main, sideboard, locale, tokensOpen]);
  const { setSequence } = preview;
  const tokenPreviews = useMemo(() => tokens.map(deckCardToPreviewDto), [tokens]);
  useEffect(() => {
    setSequence(tokenPreviews);
  }, [setSequence, tokenPreviews]);

  return (
    <section
      aria-label="Build utilities"
      className="grid max-h-[30%] min-h-0 shrink-0 grid-cols-1 gap-2 overflow-y-auto border-t border-border/40 py-2 md:grid-cols-2"
    >
      <details
        className="group min-w-0"
        open={manaOpen}
        onToggle={(event) => setManaOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary">
          <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" />
          Mana curve
        </summary>
        {manaOpen &&
          (current?.deck ? (
            <DeckStats
              cards={resolvedDeck.cards}
              compact
              showHeader={false}
              activeBucket={activeManaValue}
              onBucketClick={onManaValueChange}
            />
          ) : (
            <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
              {current?.error ?? "Loading card details…"}
            </p>
          ))}
      </details>
      <details
        className="group min-w-0"
        open={tokensOpen}
        onToggle={(event) => setTokensOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary">
          <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" />
          Tokens <span className="text-xs tabular-nums text-muted-foreground">{tokens.length}</span>
        </summary>
        {tokensOpen &&
          (!current?.deck ? (
            <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
              {current?.error ?? "Loading card details…"}
            </p>
          ) : tokens.length ? (
            <TokenSection
              tokens={tokens}
              cardSize={tokenCardSize}
              showHeader={false}
              onInspect={(token, anchor) =>
                preview.showSticky(deckCardToPreviewDto(token), undefined, undefined, anchor)
              }
              onDismiss={preview.dismiss}
              onHover={(token, event) =>
                preview.handleMouseEnter(deckCardToPreviewDto(token), event, { useDelay: true })
              }
              onLeave={preview.handleMouseLeave}
            />
          ) : (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No derived tokens for this build.
            </p>
          ))}
      </details>
      <CardHoverPreview preview={preview} />
    </section>
  );
}

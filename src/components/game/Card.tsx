import type { GameCard } from "@/types/manabrew";
import { cn } from "@/lib/utils";
import { memo, useState, useMemo, type CSSProperties } from "react";
import { CounterDisplay } from "@/components/game/CounterBadge";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { KeywordChips } from "@/components/game/CardKeywords";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { isCreature, isLethalDamage, type ScryfallImageSize } from "./game.utils";
import { isHorizontalCard } from "@/lib/cardLayout";
import { CARD_BADGES } from "./game.constants";
import { CARD_BANNER_CONTAINER, CARD_BANNER_TEXT } from "./game.styles";
import { useGameStore } from "@/stores/useGameStore";
import { asDeckCard } from "@/lib/decks";
import { ScryfallImg } from "@/components/ScryfallImg";

/** Special token types that get a more descriptive badge label. */
const TOKEN_LABELS: Record<string, string> = {
  "Blood Token": "BLOOD",
  "Treasure Token": "TREASURE",
  "Food Token": "FOOD",
  "Clue Token": "CLUE",
  "Map Token": "MAP",
  "Powerstone Token": "PWRSTONE",
};

function getTokenLabel(name: string): string {
  return TOKEN_LABELS[name] ?? "TOKEN";
}

/** Top-center status badge overlay for a card (Exerted, Morph, Bestow, etc.) */
function CardBadge({ label, style }: { label: string; style: string }) {
  return (
    <div className={CARD_BANNER_CONTAINER}>
      <span className={cn(CARD_BANNER_TEXT, style)}>{label}</span>
    </div>
  );
}

interface CardProps {
  card: GameCard;
  className?: string;
  style?: CSSProperties;
  isTapped?: boolean;
  onClick?: () => void;
  isHovered?: boolean;
  onFlip?: () => void;
  showBackFace?: boolean;
  resolution?: ScryfallImageSize;
}

function CardComponent({
  card,
  className,
  style,
  isTapped,
  onClick,
  resolution = "border_crop",
}: CardProps) {
  const [hasError, setHasError] = useState(false);
  const deck = useGameStore((s) => s.gameDecks[card.ownerId]);
  const deckCard = asDeckCard(deck, card);

  const imageUrl = deckCard.uris[resolution];
  const displayName = card.name;
  const themeColors = useTheme().gameTheme;

  const creature = isCreature(card);
  const lethal = isLethalDamage(card);
  const onBattlefield = card.zoneId === "battlefield";

  // P/T color-coding: green if buffed above base, red if debuffed
  const ptStyle = useMemo(() => {
    const fg = themeColors.textOnTinted;
    if (lethal) return { backgroundColor: themeColors.pt.lethal, color: fg };
    if (card.basePower == null || card.power == null) {
      return {
        backgroundColor: withAlpha(themeColors.pt.neutral, 0.72),
        color: fg,
      };
    }
    const currentP = parseInt(card.power, 10);
    const currentT = parseInt(card.toughness ?? "0", 10);
    const buffed = currentP > card.basePower || currentT > (card.baseToughness ?? 0);
    const debuffed = currentP < card.basePower || currentT < (card.baseToughness ?? 0);
    if (buffed && !debuffed) return { backgroundColor: themeColors.pt.buffed, color: fg };
    if (debuffed && !buffed) return { backgroundColor: themeColors.pt.debuffed, color: fg };
    if (buffed && debuffed) return { backgroundColor: themeColors.pt.buffed, color: fg };
    return {
      backgroundColor: withAlpha(themeColors.pt.neutral, 0.72),
      color: fg,
    };
  }, [lethal, card.basePower, card.power, card.toughness, card.baseToughness, themeColors]);

  const horizontal = isHorizontalCard({
    layout: card.layout,
    types: card.types,
  });

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-card text-card-foreground shadow-sm cursor-pointer group overflow-hidden",
        horizontal ? "w-[210px] aspect-[7/5]" : "w-[150px] aspect-[5/7]",
        isTapped && "rotate-90",
        // Summoning-sickness ring: dashed outline in the theme's muted
        // `prompt-action-cancel` colour, inset so it sits on the rounded
        // card edge. Re-tints automatically per preset.
        creature &&
          card.summoningSick &&
          onBattlefield &&
          "outline-2 outline-dashed outline-prompt-action-cancel -outline-offset-2",
        card.phasedOut && "opacity-30 grayscale",
        card.foil && "draft-tile-foil",
        className,
      )}
      onClick={onClick}
      style={style}
    >
      {imageUrl && !hasError ? (
        <>
          {horizontal ? (
            <ScryfallImg
              src={imageUrl}
              alt={displayName}
              title=""
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center h-[calc(100%*7/5)] aspect-[5/7] rounded-lg"
              onError={() => setHasError(true)}
              style={{ imageRendering: "auto" }}
            />
          ) : (
            <ScryfallImg
              src={imageUrl}
              alt={displayName}
              title=""
              className="absolute inset-0 w-full h-full object-contain rounded-lg"
              onError={() => setHasError(true)}
              style={{ imageRendering: "auto" }}
            />
          )}
          {/* Status badge — only the highest-priority one shows */}
          {card.exerted ? (
            <CardBadge {...CARD_BADGES.exerted} />
          ) : card.isFaceDown ? (
            <CardBadge {...CARD_BADGES.morph} />
          ) : card.isBestowed ? (
            <CardBadge {...CARD_BADGES.bestow} />
          ) : card.isTransformed ? (
            <CardBadge {...CARD_BADGES.transformed} />
          ) : card.isPlotted ? (
            <CardBadge {...CARD_BADGES.plotted} />
          ) : card.isMadnessExiled ? (
            <CardBadge {...CARD_BADGES.madnessExiled} />
          ) : card.isWarpExiled ? (
            <CardBadge {...CARD_BADGES.warpExiled} />
          ) : card.isCopy ? (
            <CardBadge {...CARD_BADGES.copy} />
          ) : card.isToken ? (
            <CardBadge label={getTokenLabel(card.name)} style={CARD_BADGES.token.style} />
          ) : null}
          {/* Keyword chips — all zones */}
          {card.keywords && card.keywords.length > 0 && <KeywordChips keywords={card.keywords} />}
          {/* Counter overlay — bottom-left, clear of the P/T box at bottom-right */}
          {card.counters && (
            <CounterDisplay
              counters={card.counters}
              size="sm"
              className="absolute bottom-1 left-1 z-10"
            />
          )}
          {/* P/T overlay — bottom-right, only for creatures */}
          {creature && card.power && card.toughness && (
            <div className="absolute bottom-1 right-1 z-10 flex flex-col items-end gap-0.5">
              <span
                className={cn("text-[10px] font-bold px-1 py-0.5 rounded leading-none")}
                style={ptStyle}
              >
                {card.power}/{card.toughness}
              </span>
              {card.damage != null && card.damage > 0 && (
                <span
                  className="text-[9px] font-bold bg-black/60 px-1 py-0.5 rounded leading-none"
                  style={{ color: withAlpha(themeColors.promptAction.attackAction, 0.9) }}
                >
                  ⚔{card.damage}
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 p-2 flex flex-col justify-between">
          <div className="flex justify-between items-start gap-1">
            <span className="font-bold text-xs leading-tight line-clamp-2">{displayName}</span>
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              {(card.isToken || card.isTransformed) && (
                <span
                  className={cn(
                    "text-[8px] font-bold px-1 py-0.5 rounded leading-none",
                    card.isTransformed ? CARD_BADGES.transformed.style : CARD_BADGES.token.style,
                  )}
                >
                  {card.isTransformed ? CARD_BADGES.transformed.label : CARD_BADGES.token.label}
                </span>
              )}
              {card.effectiveManaCost ? (
                <div className="flex flex-col items-end">
                  <span className="line-through opacity-50">
                    <ManaSymbols cost={card.manaCost} size="sm" />
                  </span>
                  <span
                    className="rounded px-0.5"
                    style={{
                      backgroundColor: withAlpha(themeColors.promptAction.defenseAction, 0.2),
                    }}
                  >
                    <ManaSymbols cost={card.effectiveManaCost} size="sm" />
                  </span>
                </div>
              ) : (
                <ManaSymbols cost={card.manaCost} size="sm" />
              )}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center px-1">
            <span className="text-xs text-muted-foreground text-center line-clamp-5">
              {card.text}
            </span>
          </div>
          {/* Counters row in text fallback */}
          {card.counters && (
            <CounterDisplay counters={card.counters} size="sm" className="mb-0.5" />
          )}
          <div className="flex justify-between items-end">
            <span className="text-xs text-muted-foreground truncate">{card.types?.join(" ")}</span>
            {creature && card.power && card.toughness && (
              <span
                className="font-bold text-sm shrink-0"
                style={{
                  color: lethal
                    ? themeColors.promptAction.attackAction
                    : card.basePower != null && parseInt(card.power, 10) > card.basePower
                      ? withAlpha(themeColors.promptAction.defenseAction, 0.92)
                      : card.basePower != null && parseInt(card.power, 10) < card.basePower
                        ? withAlpha(themeColors.promptAction.attackAction, 0.92)
                        : undefined,
                }}
              >
                {card.power}/{card.toughness}
                {card.damage != null && card.damage > 0 && (
                  <span
                    className="text-xs ml-0.5"
                    style={{ color: withAlpha(themeColors.promptAction.attackAction, 0.9) }}
                  >
                    ⚔{card.damage}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function shallowStyleEqual(a: CSSProperties | undefined, b: CSSProperties | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const Card = memo(CardComponent, (prev, next) => {
  if (
    prev.className !== next.className ||
    prev.isTapped !== next.isTapped ||
    prev.isHovered !== next.isHovered ||
    prev.showBackFace !== next.showBackFace ||
    prev.resolution !== next.resolution ||
    prev.onClick !== next.onClick ||
    prev.onFlip !== next.onFlip
  )
    return false;
  if (!shallowStyleEqual(prev.style, next.style)) return false;
  const pc = prev.card,
    nc = next.card;
  if (pc === nc) return true;
  if (
    pc.id !== nc.id ||
    pc.name !== nc.name ||
    pc.power !== nc.power ||
    pc.toughness !== nc.toughness ||
    pc.damage !== nc.damage ||
    pc.basePower !== nc.basePower ||
    pc.baseToughness !== nc.baseToughness ||
    pc.tapped !== nc.tapped ||
    pc.phasedOut !== nc.phasedOut ||
    pc.exerted !== nc.exerted ||
    pc.summoningSick !== nc.summoningSick ||
    pc.isFaceDown !== nc.isFaceDown ||
    pc.isBestowed !== nc.isBestowed ||
    pc.isTransformed !== nc.isTransformed ||
    pc.isPlotted !== nc.isPlotted ||
    pc.isMadnessExiled !== nc.isMadnessExiled ||
    pc.isWarpExiled !== nc.isWarpExiled ||
    pc.isToken !== nc.isToken ||
    pc.isCopy !== nc.isCopy ||
    pc.foil !== nc.foil ||
    pc.isDoubleFaced !== nc.isDoubleFaced ||
    pc.isPlayable !== nc.isPlayable ||
    pc.color !== nc.color ||
    pc.setCode !== nc.setCode ||
    pc.cardNumber !== nc.cardNumber ||
    pc.zoneId !== nc.zoneId ||
    pc.text !== nc.text ||
    pc.manaCost !== nc.manaCost ||
    pc.effectiveManaCost !== nc.effectiveManaCost
  )
    return false;
  if (!arraysEqual(pc.types, nc.types)) return false;
  if (!arraysEqual(pc.keywords, nc.keywords)) return false;
  if (pc.counters !== nc.counters) {
    if (JSON.stringify(pc.counters) !== JSON.stringify(nc.counters)) return false;
  }
  return true;
});

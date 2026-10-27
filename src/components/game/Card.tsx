import { CardFoilOverlay } from "@/components/game/CardFoilOverlay";
import { isEtchedOnlyPrinting } from "@/lib/cardFinish";
import type { CardDto } from "@/protocol/game";
import { cn } from "@/lib/utils";
import { memo, useState, useMemo, type CSSProperties } from "react";
import { CounterDisplay } from "@/components/game/CounterBadge";
import { CardRail, CARD_RAIL_WIDTH } from "@/components/game/CardRail";
import { PtBadge } from "@/components/game/PtBadge";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { CardChoiceIndicators } from "@/components/game/CardChoiceIndicators";
import { KeywordChips } from "@/components/game/CardKeywords";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { isCreature, isLethalDamage, type ScryfallImageSize } from "./game.utils";
import { CARD_BADGES, CARD_BACK_IMAGE_URL, GAME_CARD_SIZES } from "./game.constants";
import { CARD_BANNER_CONTAINER, CARD_BANNER_TEXT } from "./game.styles";
import { deriveCardRailState } from "@/components/game/cardRailState";
import { ScryfallImg } from "@/components/ScryfallImg";
import { useResolvedGameCard } from "@/hooks/useResolvedGameCard";
import { isHorizontalGameCard } from "@/lib/horizontalGameCard";
import { GeneratedCardImage } from "./GeneratedCardImage";
import { usePreferencesStore, type InlineCardStyle } from "@/stores/usePreferencesStore";
import { gameCardFaceIndex } from "@/lib/gameCard";
const TOKEN_LABELS: Record<string, string> = {
  get "Blood Token"() {
    return `BLOOD`;
  },
  get "Treasure Token"() {
    return `TREASURE`;
  },
  get "Food Token"() {
    return `FOOD`;
  },
  get "Clue Token"() {
    return `CLUE`;
  },
  get "Map Token"() {
    return `MAP`;
  },
  get "Powerstone Token"() {
    return `PWRSTONE`;
  },
};
function getTokenLabel(name: string): string {
  return TOKEN_LABELS[name] ?? `TOKEN`;
}
function CardBadge({ label, style }: { label: string; style: string }) {
  return (
    <div className={CARD_BANNER_CONTAINER}>
      <span className={cn(CARD_BANNER_TEXT, style)}>{label}</span>
    </div>
  );
}
interface CardProps {
  card: CardDto & {
    zoneId?: string;
  };
  className?: string;
  style?: CSSProperties;
  isTapped?: boolean;
  onClick?: () => void;
  isHovered?: boolean;
  onFlip?: () => void;
  showBackFace?: boolean;
  resolution?: ScryfallImageSize;
  presentation?: InlineCardStyle;
  /** Render just the printed card image — no game-state overlays (keyword chips,
   * counters, badges, P/T). For pickers showing library/hidden-zone cards. */
  bare?: boolean;
}
function CardComponent({
  card,
  className,
  style,
  isTapped,
  onClick,
  showBackFace = gameCardFaceIndex(card) === 1,
  bare,
  resolution = "border_crop",
  presentation,
}: CardProps) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const { deckCard, cardFaces, info, imageUrl: resolveImageUrl } = useResolvedGameCard(card);
  const faceIndex = showBackFace ? 1 : 0;
  const faceless = card.isFaceDown || !card.identity.name;
  const imageUrl = faceless ? CARD_BACK_IMAGE_URL : resolveImageUrl(faceIndex, resolution);
  const hasError = imageUrl === failedUrl;
  const defaultPresentation = usePreferencesStore((state) => state.promptCardStyle);
  const generated = !faceless && (presentation ?? defaultPresentation) === "rules";
  const displayName = faceless ? "Face-down card" : card.identity.name;
  const themeColors = useTheme().gameTheme;
  const creature = isCreature(card);
  const lethal = isLethalDamage(card);
  const onBattlefield = card.zoneId === "battlefield";
  const rail = deriveCardRailState(card);
  const railRightClass = rail ? "!right-[calc(5.5cqw+var(--card-rail-width)+0.35rem)]" : undefined;
  const visibleCounters =
    rail?.kind === "saga" && card.counters
      ? Object.fromEntries(
          Object.entries(card.counters).filter(([type, count]) => count > 0 && type !== "Lore"),
        )
      : card.counters;
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
  const horizontal =
    !faceless &&
    isHorizontalGameCard(card, deckCard.layout, faceIndex, cardFaces.faces[faceIndex]?.typeLine);
  return (
    <div
      className={cn(
        "relative @container rounded-lg border bg-card text-card-foreground shadow-sm cursor-pointer group",
        horizontal ? "aspect-[7/5]" : "aspect-[5/7]",
        isTapped && "rotate-90",
        creature &&
          card.summoningSick &&
          onBattlefield &&
          "outline-2 outline-dashed outline-card-status-summoning-sick -outline-offset-2",
        card.phasedOut && "opacity-30 grayscale",
        className,
      )}
      onClick={onClick}
      style={
        {
          ["--card-rail-width" as string]: CARD_RAIL_WIDTH,
          width: horizontal ? GAME_CARD_SIZES.hand.height : GAME_CARD_SIZES.hand.width,
          ...style,
        } as CSSProperties
      }
    >
      <CardFoilOverlay
        enabled={!faceless && !generated}
        foil={!faceless && !!card.foil}
        cosmetics={faceless ? undefined : card.cosmetics}
        etched={!faceless && isEtchedOnlyPrinting(info?.finishes)}
      />
      {generated || (imageUrl && !hasError) ? (
        <>
          {generated ? (
            <GeneratedCardImage
              card={card}
              deckCard={deckCard}
              faceIndex={faceIndex}
              className={
                horizontal
                  ? "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center h-[calc(100%*7/5)] aspect-[5/7] rounded-lg"
                  : "absolute inset-0 h-full w-full rounded-lg"
              }
              fallback={
                imageUrl && !hasError ? (
                  <ScryfallImg
                    src={imageUrl}
                    alt={displayName}
                    className="h-full w-full rounded-[inherit] object-contain"
                    onError={() => setFailedUrl(imageUrl)}
                    draggable={false}
                  />
                ) : undefined
              }
            />
          ) : (
            <ScryfallImg
              src={imageUrl}
              alt={displayName}
              title=""
              className={
                horizontal
                  ? "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center h-[calc(100%*7/5)] aspect-[5/7] rounded-lg"
                  : "absolute inset-0 w-full h-full object-contain rounded-lg"
              }
              onError={() => setFailedUrl(imageUrl)}
              style={{ imageRendering: "auto" }}
            />
          )}
          {!bare && !faceless && (
            <>
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
              ) : card.identity.isToken ? (
                <CardBadge
                  label={getTokenLabel(card.identity.name)}
                  style={CARD_BADGES.token.style}
                />
              ) : null}
              {card.keywords && card.keywords.length > 0 && (
                <KeywordChips
                  keywords={card.keywords}
                  className={(card.choices?.length ?? 0) > 0 ? "top-[42%]" : undefined}
                />
              )}
              {visibleCounters && (
                <CounterDisplay
                  counters={visibleCounters}
                  size="sm"
                  className="absolute bottom-1 left-1 z-10"
                />
              )}
              {creature && card.power && card.toughness && (
                <PtBadge
                  value={`${card.power}/${card.toughness}`}
                  style={ptStyle}
                  className={railRightClass}
                >
                  {card.damage != null && card.damage > 0 && (
                    <span
                      className="font-bold bg-black/60 rounded leading-none"
                      style={{
                        fontSize: "0.9em",
                        padding: "0.1em 0.35em",
                        color: withAlpha(themeColors.promptAction.attackAction, 0.9),
                      }}
                    >
                      ⚔{card.damage}
                    </span>
                  )}
                </PtBadge>
              )}
              {rail && <CardRail state={rail} />}
            </>
          )}
        </>
      ) : faceless ? (
        <div className="absolute inset-0 flex items-center justify-center bg-card text-ui-meta">
          {displayName}
        </div>
      ) : (
        <div className="absolute inset-0 p-2 flex gap-2 bg-card">
          <div
            className={cn(
              "flex-1 min-w-0 flex flex-col gap-1.5",
              rail && "pr-[calc(var(--card-rail-width)+0.5rem)]",
            )}
          >
            <div className="flex justify-between items-start gap-1">
              <span className="font-bold text-xs leading-tight line-clamp-2">{displayName}</span>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                {(card.identity.isToken || card.isTransformed) && (
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
            <div className="flex-1 text-xs text-muted-foreground text-center line-clamp-5 whitespace-pre-wrap">
              {card.text}
            </div>
            {visibleCounters && <CounterDisplay counters={visibleCounters} size="sm" />}
            <div className="flex justify-between items-end">
              <span className="text-xs text-muted-foreground truncate">
                {card.types?.join(" ")}
              </span>
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
          {rail && <CardRail state={rail} />}
        </div>
      )}
      {!bare && !faceless && (
        <CardChoiceIndicators card={card} className="absolute left-1 right-1 top-[18%] z-10" />
      )}
    </div>
  );
}
export const Card = memo(CardComponent);

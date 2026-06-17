import { createPortal } from "react-dom";
import { Loader2, RotateCw } from "lucide-react";
import type { DeckCard, GameCard } from "@/types/manabrew";
import { CounterDisplay } from "@/components/game/CounterBadge";
import { GameIcon } from "@/components/game/GameIcon";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { TextWithMana } from "@/components/game/TextWithMana";
import { FLASH_CARD_SIZE } from "./game.styles";
import { CARD_BADGES } from "./game.constants";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { isCreature, isLethalDamage } from "./game.utils";
import { isHorizontalCard } from "@/lib/cardLayout";
import { cn } from "@/lib/utils";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { asDeckCard } from "@/lib/decks";
import { ScryfallImg } from "@/components/ScryfallImg";
import { useCardFaces } from "@/hooks/useCardFaces";
import { useKeybindings } from "@/hooks/useKeybindings";

interface CardPreviewProps {
  card: GameCard;
  mouseX: number;
  mouseY: number;
  anchorRect?: DOMRect | null;
  placement?: "auto" | "top-center" | "pinned";
  showBackFace?: boolean;
  actions?: HandActionOption[];
  onSelectAction?: (action: HandActionOption) => void;
  onDismiss?: () => void;
  onFlip?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isSticky?: boolean;
  slot?: HTMLElement | null;
  imageSize?: "normal" | "large";
}

const { w: CARD_W, h: CARD_H } = FLASH_CARD_SIZE;
const ACTIONS_PANEL_W = 220;
const MAX_PREVIEW_KEYWORDS = 8;

function CardDetailOverlay({ card, horizontal }: { card: GameCard; horizontal: boolean }) {
  const themeColors = useTheme().gameTheme;
  const creature = isCreature(card);
  const lethal = isLethalDamage(card);

  const statusBadges = useMemo(() => {
    const out: { key: string; label: string; style: string }[] = [];
    if (card.exerted) out.push({ key: "exerted", ...CARD_BADGES.exerted });
    if (card.isFaceDown) out.push({ key: "morph", ...CARD_BADGES.morph });
    if (card.isBestowed) out.push({ key: "bestow", ...CARD_BADGES.bestow });
    if (card.isTransformed) out.push({ key: "transformed", ...CARD_BADGES.transformed });
    if (card.isPlotted) out.push({ key: "plotted", ...CARD_BADGES.plotted });
    if (card.isMadnessExiled) out.push({ key: "madness", ...CARD_BADGES.madnessExiled });
    if (card.isWarpExiled) out.push({ key: "warped", ...CARD_BADGES.warpExiled });
    if (card.isCopy) out.push({ key: "copy", ...CARD_BADGES.copy });
    if (card.isToken) out.push({ key: "token", ...CARD_BADGES.token });
    return out;
  }, [
    card.exerted,
    card.isFaceDown,
    card.isBestowed,
    card.isTransformed,
    card.isPlotted,
    card.isMadnessExiled,
    card.isWarpExiled,
    card.isCopy,
    card.isToken,
  ]);

  const keywords = card.keywords ?? [];
  const visibleKeywords = keywords.slice(0, MAX_PREVIEW_KEYWORDS);
  const hiddenKeywordCount = keywords.length - visibleKeywords.length;

  const damage = card.damage ?? 0;

  const ptState = useMemo(() => {
    if (lethal) return "lethal" as const;
    if (card.basePower == null || card.power == null) return "unknown" as const;
    const curP = parseInt(card.power, 10);
    const curT = parseInt(card.toughness ?? "0", 10);
    if (curP > card.basePower || curT > (card.baseToughness ?? 0)) return "buffed" as const;
    if (curP < card.basePower || curT < (card.baseToughness ?? 0)) return "debuffed" as const;
    return "neutral" as const;
  }, [lethal, card.basePower, card.baseToughness, card.power, card.toughness]);

  const ptStyle: CSSProperties = {
    color: themeColors.textOnTinted,
    backgroundColor:
      ptState === "lethal"
        ? themeColors.pt.lethal
        : ptState === "buffed"
          ? themeColors.pt.buffed
          : ptState === "debuffed"
            ? themeColors.pt.debuffed
            : themeColors.pt.neutral,
  };
  const ptToughness = parseInt(card.toughness ?? "0", 10);
  if (ptState !== "lethal" && damage > 0 && ptToughness > 0) {
    const tint = withAlpha(themeColors.pt.lethal, Math.min(0.85, damage / ptToughness));
    ptStyle.backgroundImage = `linear-gradient(${tint}, ${tint})`;
  }

  const isPlaneswalker = card.types?.some((t) => t.toLowerCase() === "planeswalker") ?? false;
  const loyalty = card.counters?.Loyalty;
  const showLoyalty = isPlaneswalker && loyalty != null && !horizontal;
  const showTopStrip = statusBadges.length > 0 || keywords.length > 0;
  const showPT = creature && !horizontal && !!card.power && !!card.toughness;

  const overlayCounters = useMemo(() => {
    if (!card.counters) return null;
    const entries = Object.entries(card.counters).filter(
      ([type, n]) => n > 0 && !(showLoyalty && type === "Loyalty"),
    );
    return entries.length ? Object.fromEntries(entries) : null;
  }, [card.counters, showLoyalty]);

  return (
    <>
      {damage > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: withAlpha(
              themeColors.pt.lethal,
              Math.min(0.5, (ptToughness > 0 ? damage / ptToughness : 1) * 0.5),
            ),
          }}
        />
      )}
      {showTopStrip && (
        <div className="absolute top-2 left-2 right-2 z-10 flex flex-col items-center gap-1 pointer-events-none">
          {statusBadges.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center">
              {statusBadges.map((b) => (
                <span
                  key={b.key}
                  className={cn(
                    "text-[11px] font-bold px-2 py-0.5 rounded shadow-md uppercase tracking-wide",
                    b.style,
                  )}
                >
                  {b.label}
                </span>
              ))}
            </div>
          )}
          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center">
              {visibleKeywords.map((kw, i) => {
                const colonIdx = kw.indexOf(":");
                const label = colonIdx === -1 ? kw : kw.slice(0, colonIdx);
                const cost = colonIdx === -1 ? null : kw.slice(colonIdx + 1);
                return (
                  <span
                    key={`${kw}-${i}`}
                    className="inline-flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-wide bg-black/75 text-white px-2 py-0.5 rounded shadow-md"
                  >
                    {label}
                    {cost && <ManaSymbols cost={cost} size="sm" />}
                  </span>
                );
              })}
              {hiddenKeywordCount > 0 && (
                <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-wide bg-black/75 text-white px-2 py-0.5 rounded shadow-md">
                  +{hiddenKeywordCount}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {showPT && (
        <div className="absolute bottom-[5.5%] right-[5.5%] z-10 flex flex-col items-end gap-1 pointer-events-none">
          {(ptState === "buffed" || ptState === "debuffed") &&
            card.basePower != null &&
            card.baseToughness != null && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/60 text-white/80 line-through leading-none">
                {card.basePower}/{card.baseToughness}
              </span>
            )}
          <span
            className="text-lg font-bold px-3 py-1 rounded-md shadow-md leading-none"
            style={ptStyle}
          >
            {card.power}/{card.toughness}
          </span>
        </div>
      )}

      {showLoyalty && (
        <div className="absolute bottom-[5.5%] right-[5.5%] z-10 pointer-events-none">
          <span
            className="text-lg font-bold px-3 py-1 rounded-md shadow-md leading-none"
            style={{
              backgroundColor: themeColors.counter.loyalty,
              color: themeColors.textOnTinted,
            }}
          >
            {loyalty}
          </span>
        </div>
      )}

      {overlayCounters && (
        <div
          className={cn(
            "absolute bottom-1 left-1 z-10 max-w-[70%]",
            "flex flex-wrap gap-0.5 pointer-events-none",
            showPT || showLoyalty ? "pr-12" : "right-1",
          )}
        >
          <CounterDisplay counters={overlayCounters} size="md" />
        </div>
      )}

      {card.isRingBearer && (
        <div
          className="absolute top-2 left-2 z-10 flex h-9 w-9 items-center justify-center rounded-full shadow-lg ring-2 pointer-events-none"
          style={{
            backgroundColor: themeColors.badges.ring,
            color: themeColors.textOnTinted,
            // @ts-expect-error CSS var
            "--tw-ring-color": themeColors.badges.ring,
          }}
          title="Ring-bearer"
        >
          <GameIcon name="ring" className="h-6 w-6" />
        </div>
      )}
    </>
  );
}

export function CardPreview({
  card,
  mouseX,
  mouseY,
  anchorRect,
  placement = "auto",
  showBackFace = false,
  actions,
  onSelectAction,
  onDismiss,
  onFlip,
  onMouseEnter,
  onMouseLeave,
  isSticky = false,
  slot,
  imageSize = "large",
}: CardPreviewProps) {
  const hasActions = actions && actions.length > 0 && onSelectAction;
  const showSidePanel = hasActions;
  const themeColors = useTheme().gameTheme;
  const showHoverAreas = useGameDevStore((s) => s.showHoverAreas);
  const ringColor = themeColors.cardRing;
  const deck = useGameStore((s) => s.gameDecks[card.ownerId]);
  const deckCard: DeckCard = deck ? asDeckCard(deck, card) : (card as unknown as DeckCard);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const cardFaces = useCardFaces({
    name: card.name,
    setCode: deckCard.setCode,
    cardNumber: deckCard.cardNumber,
  });
  const front = cardFaces.faces[0];
  const back = cardFaces.faces[1];
  const imageUrl = deckCard.uris[imageSize] || front?.imageUris?.[imageSize];
  const hasFlippableFaces =
    cardFaces.isFlippable && !!front?.imageUris?.[imageSize] && !!back?.imageUris?.[imageSize];
  const doubleFacedData = hasFlippableFaces
    ? {
        frontImageUrl: front!.imageUris![imageSize],
        backImageUrl: back!.imageUris![imageSize],
        frontImageUrlLow: front!.imageUris!.normal,
        backImageUrlLow: back!.imageUris!.normal,
        frontName: front!.name,
        backName: back!.name,
      }
    : null;

  useKeybindings({
    "flip-card": () => {
      if (onFlip && hasFlippableFaces) onFlip();
    },
  });

  useEffect(() => {
    if (!hasActions || !onDismiss) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onDismiss!();
        return;
      }
      const num = parseInt(e.key);
      if (num >= 1 && num <= actions!.length) {
        e.preventDefault();
        onSelectAction!(actions![num - 1]);
      }
    }
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-card-preview]")) {
        onDismiss!();
      }
    }
    window.addEventListener("keydown", handleKey);
    const timer = setTimeout(() => {
      if (isSticky) {
        window.addEventListener("mousedown", handleClick);
      }
    }, 100);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClick);
    };
  }, [hasActions, isSticky, onDismiss, onSelectAction, actions]);

  const horizontal = isHorizontalCard({
    layout: card.layout,
    types: card.types,
  });
  const cardWidth = horizontal ? CARD_H : CARD_W;
  const cardHeight = horizontal ? CARD_W : CARD_H;

  let cardLeft: number;
  let top: number;
  let actionsOnRight: boolean;

  if (placement === "pinned") {
    cardLeft = window.innerWidth - cardWidth - 16;
    top = 80;
    actionsOnRight = false;
  } else if (placement === "top-center" && anchorRect) {
    cardLeft = anchorRect.left + anchorRect.width / 2 - cardWidth / 2;
    top = anchorRect.top - cardHeight - 12;
    cardLeft = Math.max(8, Math.min(cardLeft, window.innerWidth - cardWidth - 8));
    top = Math.max(8, top);

    const spaceAfterCard = window.innerWidth - (cardLeft + cardWidth);
    actionsOnRight = spaceAfterCard >= ACTIONS_PANEL_W + 16;
  } else {
    const anchorLeft = anchorRect ? anchorRect.left : mouseX;
    const anchorRight = anchorRect ? anchorRect.right : mouseX;
    const anchorTop = anchorRect ? anchorRect.top : mouseY;
    const anchorBottom = anchorRect ? anchorRect.bottom : mouseY;
    const anchorMidY = anchorRect ? anchorRect.top + anchorRect.height / 2 : mouseY;

    const fitsRight = anchorRight + 16 + cardWidth <= window.innerWidth - 8;
    const fitsLeft = anchorLeft - 16 - cardWidth >= 8;

    if (fitsRight) {
      cardLeft = anchorRight + 16;
    } else if (fitsLeft) {
      cardLeft = anchorLeft - cardWidth - 16;
    } else {
      cardLeft = Math.max(
        8,
        Math.min((anchorLeft + anchorRight) / 2 - cardWidth / 2, window.innerWidth - cardWidth - 8),
      );
    }

    if (fitsRight || fitsLeft) {
      top = Math.min(Math.max(anchorMidY - cardHeight / 2, 8), window.innerHeight - cardHeight - 8);
    } else {
      const spaceAbove = anchorTop - 16;
      const spaceBelow = window.innerHeight - anchorBottom - 16;
      top =
        spaceBelow >= spaceAbove
          ? Math.min(anchorBottom + 12, window.innerHeight - cardHeight - 8)
          : Math.max(8, anchorTop - cardHeight - 12);
    }

    const spaceAfterCard = window.innerWidth - (cardLeft + cardWidth);
    actionsOnRight = spaceAfterCard >= ACTIONS_PANEL_W + 16;
  }

  const hasDoubleFace = !!doubleFacedData;
  const currentImageUrl = hasDoubleFace && showBackFace ? doubleFacedData.backImageUrl : imageUrl;
  const currentCardName = hasDoubleFace && showBackFace ? doubleFacedData.backName : card.name;
  const currentLowResUrl =
    imageSize !== "large"
      ? null
      : hasDoubleFace
        ? showBackFace
          ? doubleFacedData.backImageUrlLow
          : doubleFacedData.frontImageUrlLow
        : deckCard.uris.normal;
  const imgLoaded = loadedSrc === currentImageUrl;

  return createPortal(
    <>
      {hasActions && isSticky && (
        <div
          className="fixed inset-0 z-[9998] bg-black/30 animate-in fade-in duration-150"
          onClick={onDismiss}
        />
      )}
      <div
        data-card-preview
        className={cn(
          "select-none transition-opacity",
          slot
            ? "relative w-full h-full flex items-start justify-center pointer-events-none"
            : cn(
                "fixed z-[9999]",
                hasActions && placement !== "pinned"
                  ? "pointer-events-auto"
                  : "pointer-events-none",
              ),
        )}
        style={slot ? undefined : { left: cardLeft, top }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="relative" style={{ width: cardWidth, height: cardHeight }}>
          <div
            className={cn(
              "w-full h-full rounded-xl shadow-2xl overflow-hidden bg-black transition-shadow duration-200 relative",
              hasActions ? "ring-2" : "ring-1 ring-black/20",
              card.foil && "draft-tile-foil",
            )}
            style={
              hasActions
                ? ({
                    "--tw-ring-color": ringColor,
                    boxShadow: `0 0 20px ${ringColor}`,
                  } as CSSProperties)
                : undefined
            }
          >
            {currentImageUrl ? (
              <>
                {currentLowResUrl &&
                  !imgLoaded &&
                  (horizontal ? (
                    <ScryfallImg
                      src={currentLowResUrl}
                      alt=""
                      title=""
                      aria-hidden
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center h-[calc(100%*7/5)] aspect-[5/7]"
                    />
                  ) : (
                    <ScryfallImg
                      src={currentLowResUrl}
                      alt=""
                      title=""
                      aria-hidden
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ))}
                {horizontal ? (
                  <ScryfallImg
                    src={currentImageUrl}
                    alt={currentCardName}
                    title=""
                    onLoad={() => setLoadedSrc(currentImageUrl)}
                    className={cn(
                      "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center h-[calc(100%*7/5)] aspect-[5/7] transition-opacity duration-200",
                      imgLoaded ? "opacity-100" : "opacity-0",
                    )}
                  />
                ) : (
                  <ScryfallImg
                    src={currentImageUrl}
                    alt={currentCardName}
                    title=""
                    onLoad={() => setLoadedSrc(currentImageUrl)}
                    className={cn(
                      "w-full h-full object-cover transition-opacity duration-200",
                      imgLoaded ? "opacity-100" : "opacity-0",
                    )}
                  />
                )}
                {!imgLoaded && !currentLowResUrl && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 bg-black">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground text-center">
                      {currentCardName}
                    </span>
                  </div>
                )}
                <CardDetailOverlay card={card} horizontal={horizontal} />
                {showHoverAreas && (
                  <div
                    className="pointer-events-none absolute inset-0 z-30"
                    style={{ backgroundColor: withAlpha(themeColors.success, 0.28) }}
                  />
                )}
                {hasDoubleFace && onFlip && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFlip();
                    }}
                    className="absolute top-2 right-2 z-20 inline-flex items-center gap-1 rounded-full bg-black/65 hover:bg-black/85 text-white text-[10px] font-semibold uppercase tracking-wide px-2 py-1 shadow pointer-events-auto"
                    title={`Flip card (F) — ${showBackFace ? doubleFacedData.frontName : doubleFacedData.backName}`}
                  >
                    <RotateCw className="h-3 w-3" />
                    {showBackFace ? "Front" : "Back"}
                  </button>
                )}
              </>
            ) : (
              <div className="w-full h-full p-4 flex flex-col gap-2 bg-card">
                <div className="flex justify-between items-start">
                  <span className="font-bold text-sm leading-tight">{currentCardName}</span>
                  {!hasDoubleFace &&
                    (card.effectiveManaCost ? (
                      <div className="flex flex-col items-end">
                        <span className="line-through opacity-50">
                          <ManaSymbols cost={card.manaCost} size="md" />
                        </span>
                        <span
                          className="rounded px-0.5"
                          style={{ backgroundColor: withAlpha(ringColor, 0.2) }}
                        >
                          <ManaSymbols cost={card.effectiveManaCost} size="md" />
                        </span>
                      </div>
                    ) : (
                      <ManaSymbols cost={card.manaCost} size="md" />
                    ))}
                </div>
                {!hasDoubleFace && (
                  <div className="text-xs text-muted-foreground">{card.types?.join(" ")}</div>
                )}
                <div className="flex-1 text-xs text-foreground/80 whitespace-pre-wrap">
                  {hasDoubleFace && showBackFace
                    ? `Back face: ${doubleFacedData!.backName}`
                    : hasDoubleFace && !showBackFace
                      ? `Front face: ${doubleFacedData!.frontName}`
                      : card.text}
                </div>
                {card.counters && <CounterDisplay counters={card.counters} size="md" />}
                {card.power && card.toughness && (
                  <div className="text-right font-bold text-sm">
                    {card.power}/{card.toughness}
                  </div>
                )}
              </div>
            )}
          </div>

          {showSidePanel && (
            <div
              className="absolute top-0 flex flex-col gap-1.5"
              style={
                actionsOnRight
                  ? { left: cardWidth + 10, width: ACTIONS_PANEL_W }
                  : { right: cardWidth + 10, width: ACTIONS_PANEL_W }
              }
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: actionsOnRight ? -10 - cardWidth : 0,
                  width: cardWidth + 10 + ACTIONS_PANEL_W,
                  height: cardHeight,
                  backgroundColor: showHoverAreas
                    ? withAlpha(themeColors.success, 0.28)
                    : "transparent",
                  borderBottomRightRadius: actionsOnRight ? "100%" : "0",
                  borderBottomLeftRadius: actionsOnRight ? "0" : "100%",
                  zIndex: -1,
                }}
              />

              {actions?.map((action, idx) => (
                <button
                  key={idx}
                  onClick={() => onSelectAction(action)}
                  className={cn(
                    "group w-full text-left rounded-lg text-xs font-medium",
                    "bg-popover text-popover-foreground border border-border",
                    "backdrop-blur-md shadow-lg",
                    "transition-all duration-150 ease-out",
                    "hover:scale-[1.02] hover:-translate-y-px hover:shadow-xl",
                    "flex flex-col px-3 py-2",
                  )}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = withAlpha(ringColor, 0.12);
                    e.currentTarget.style.borderColor = ringColor;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "";
                    e.currentTarget.style.borderColor = "";
                  }}
                >
                  <span className="flex items-center justify-between w-full mb-0.5">
                    <span className="text-xs font-bold min-w-[22px] h-5 flex items-center justify-center rounded border border-border bg-muted shadow-[0_1px_0_rgba(0,0,0,0.1)]">
                      {idx + 1}
                    </span>
                    {action.cost && (
                      <span className="flex items-center gap-0.5 text-[11px] opacity-90">
                        <TextWithMana text={action.cost} manaSize="sm" />
                      </span>
                    )}
                  </span>
                  <span className="leading-snug text-[13px] font-semibold">
                    <TextWithMana text={action.label} manaSize="sm" />
                  </span>
                </button>
              ))}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[10px] text-muted-foreground">
                <span>
                  <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">
                    1
                  </kbd>
                  –
                  <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">
                    9
                  </kbd>{" "}
                  select
                </span>
                <span>
                  <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">
                    Esc
                  </kbd>{" "}
                  close
                </span>
                {hasFlippableFaces && (
                  <span>
                    <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">
                      F
                    </kbd>{" "}
                    flip
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>,
    slot ?? document.body,
  );
}

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
import { useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { asDeckCard } from "@/lib/decks";
import { ScryfallImg } from "@/components/ScryfallImg";
import { useCard } from "@/stores/useScryfallStore";

interface CardPreviewProps {
  card: GameCard;
  mouseX: number;
  mouseY: number;
  anchorRect?: DOMRect | null;
  placement?: "auto" | "top-center" | "pinned";
  showBackFace?: boolean;
  /** Available actions for this card (cast options + activated abilities). */
  actions?: HandActionOption[];
  /** Called when the user selects an action from the preview. */
  onSelectAction?: (action: HandActionOption) => void;
  /** Called to dismiss the preview. */
  onDismiss?: () => void;
  /** Toggle the back face of a double-faced card. */
  onFlip?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isSticky?: boolean;
  slot?: HTMLElement | null;
  imageSize?: "normal" | "large";
}

const { w: CARD_W, h: CARD_H } = FLASH_CARD_SIZE;
const ACTIONS_PANEL_W = 220;

function CardDetailOverlay({ card }: { card: GameCard }) {
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

  const ptStyle = useMemo<CSSProperties>(() => {
    const fg = themeColors.textOnTinted;
    if (lethal) return { backgroundColor: themeColors.pt.lethal, color: fg };
    if (card.basePower == null || card.power == null) {
      return { backgroundColor: withAlpha(themeColors.pt.neutral, 0.85), color: fg };
    }
    const curP = parseInt(card.power, 10);
    const curT = parseInt(card.toughness ?? "0", 10);
    const buffed = curP > card.basePower || curT > (card.baseToughness ?? 0);
    const debuffed = curP < card.basePower || curT < (card.baseToughness ?? 0);
    if (buffed) return { backgroundColor: themeColors.pt.buffed, color: fg };
    if (debuffed) return { backgroundColor: themeColors.pt.debuffed, color: fg };
    return { backgroundColor: withAlpha(themeColors.pt.neutral, 0.85), color: fg };
  }, [lethal, card.basePower, card.baseToughness, card.power, card.toughness, themeColors]);

  const showTopStrip = statusBadges.length > 0 || keywords.length > 0;
  const showPT = creature && !!card.power && !!card.toughness;
  const damage = card.damage ?? 0;

  return (
    <>
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
              {keywords.map((kw, i) => {
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
            </div>
          )}
        </div>
      )}

      {showPT && (
        <div className="absolute bottom-2 right-2 z-10 flex flex-col items-end gap-1 pointer-events-none">
          <span
            className="text-base font-bold px-2 py-0.5 rounded shadow-md leading-none"
            style={ptStyle}
          >
            {card.power}/{card.toughness}
          </span>
          {damage > 0 && (
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded shadow-md leading-none"
              style={{
                backgroundColor: withAlpha(themeColors.promptAction.attackAction, 0.92),
                color: themeColors.textOnTinted,
              }}
            >
              ⚔ {damage}
            </span>
          )}
        </div>
      )}

      {card.counters && Object.values(card.counters).some((n) => n > 0) && (
        <div
          className={cn(
            "absolute bottom-1 left-1 z-10 max-w-[70%]",
            "flex flex-wrap gap-0.5 pointer-events-auto",
            showPT ? "pr-12" : "right-1",
          )}
        >
          <CounterDisplay counters={card.counters} size="sm" />
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

/**
 * Floating card preview rendered into document.body via portal.
 * Positions itself near the cursor or an anchor element, clamped to viewport edges.
 * When actions are available the preview becomes interactive and locks in place
 * until the user clicks an action, presses Escape, or clicks outside.
 */
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
  const ringColor = themeColors.cardRing; // matches battlefield playable color
  const deck = useGameStore((s) => s.gameDecks[card.ownerId]);
  // Deck-editor hover bypasses the game runtime: `gameDecks[ownerId]` is
  // undefined and the hovered object is a `DeckCard` (uris already on it).
  // Fall back to that case instead of going through `asDeckCard`.
  const deckCard: DeckCard = deck ? asDeckCard(deck, card) : (card as unknown as DeckCard);
  const isLoading = false;
  const imageUrl = deckCard.uris[imageSize];
  const scryfallEntry = useCard({
    name: card.name,
    setCode: deckCard.setCode,
    collectorNumber: deckCard.cardNumber,
  });
  const faces = scryfallEntry?.info?.card_faces;
  const facesHaveImages =
    !!faces &&
    faces.length >= 2 &&
    !!faces[0].image_uris?.[imageSize] &&
    !!faces[1].image_uris?.[imageSize];
  const derivedBackImageUrl =
    !facesHaveImages && deckCard.isDoubleFaced && imageUrl?.includes("/front/")
      ? imageUrl.replace("/front/", "/back/")
      : null;
  const doubleFacedData = facesHaveImages
    ? {
        frontImageUrl: faces![0].image_uris![imageSize],
        backImageUrl: faces![1].image_uris![imageSize],
        frontName: faces![0].name,
        backName: faces![1].name,
      }
    : derivedBackImageUrl
      ? {
          frontImageUrl: imageUrl,
          backImageUrl: derivedBackImageUrl,
          frontName: card.name,
          backName: card.name,
        }
      : null;
  const hasFlippableFaces = !!doubleFacedData;

  useEffect(() => {
    if (!onFlip || !hasFlippableFaces) return;
    function handleFlipKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        if (target?.matches?.("input, textarea, [contenteditable='true']")) return;
        e.preventDefault();
        onFlip!();
      }
    }
    window.addEventListener("keydown", handleFlipKey);
    return () => window.removeEventListener("keydown", handleFlipKey);
  }, [onFlip, hasFlippableFaces]);

  // Dismiss on Escape, outside click, or number key shortcut
  useEffect(() => {
    if (!hasActions || !onDismiss) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onDismiss!();
        return;
      }
      // Number keys 1-9 activate the corresponding action
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
    // Clamp to screen
    cardLeft = Math.max(8, Math.min(cardLeft, window.innerWidth - cardWidth - 8));
    top = Math.max(8, top);

    const spaceAfterCard = window.innerWidth - (cardLeft + cardWidth);
    actionsOnRight = spaceAfterCard >= ACTIONS_PANEL_W + 16;
  } else {
    // Use anchorRect if available, otherwise fallback to mouse coordinates
    const anchorX = anchorRect ? anchorRect.right : mouseX;
    const anchorY = anchorRect ? anchorRect.top + anchorRect.height / 2 : mouseY;

    const spaceRight = window.innerWidth - anchorX;
    cardLeft =
      spaceRight > cardWidth + 24
        ? anchorX + 16
        : (anchorRect ? anchorRect.left : mouseX) - cardWidth - 16;

    const spaceAfterCard = window.innerWidth - (cardLeft + cardWidth);
    actionsOnRight = spaceAfterCard >= ACTIONS_PANEL_W + 16;

    top = Math.min(Math.max(anchorY - cardHeight / 2, 8), window.innerHeight - cardHeight - 8);
  }

  const hasDoubleFace = !!doubleFacedData;
  const currentImageUrl = hasDoubleFace && showBackFace ? doubleFacedData.backImageUrl : imageUrl;
  const currentCardName = hasDoubleFace && showBackFace ? doubleFacedData.backName : card.name;

  return createPortal(
    <>
      {/* Backdrop dim when interactive */}
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
                placement === "pinned" ? "pointer-events-none" : "pointer-events-auto",
              ),
        )}
        style={slot ? undefined : { left: cardLeft, top }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="relative" style={{ width: cardWidth, height: cardHeight }}>
          {/* Card image */}
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
            {isLoading && !currentImageUrl ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground text-center">{currentCardName}</span>
              </div>
            ) : currentImageUrl ? (
              <>
                {horizontal ? (
                  <ScryfallImg
                    src={currentImageUrl}
                    alt={currentCardName}
                    title=""
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center h-[calc(100%*7/5)] aspect-[5/7]"
                  />
                ) : (
                  <ScryfallImg
                    src={currentImageUrl}
                    alt={currentCardName}
                    title=""
                    className="w-full h-full object-cover"
                  />
                )}
                <CardDetailOverlay card={card} />
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

          {/* Actions + extra-info side panel */}
          {showSidePanel && (
            <div
              className="absolute top-0 flex flex-col gap-1.5"
              style={
                actionsOnRight
                  ? { left: cardWidth + 10, width: ACTIONS_PANEL_W }
                  : { right: cardWidth + 10, width: ACTIONS_PANEL_W }
              }
            >
              {/* Curved invisible bridge to maintain hover without blocking cards below */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: actionsOnRight ? -10 - cardWidth : 0,
                  width: cardWidth + 10 + ACTIONS_PANEL_W,
                  height: cardHeight,
                  backgroundColor: "transparent",
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
            </div>
          )}
        </div>
      </div>
    </>,
    slot ?? document.body,
  );
}

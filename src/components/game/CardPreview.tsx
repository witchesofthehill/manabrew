import { createPortal } from "react-dom";
import { Loader2, RotateCw } from "lucide-react";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import { CounterDisplay } from "@/components/game/CounterBadge";
import { CARD_RAIL_WIDTH } from "@/components/game/CardRail";
import { CardRailPreview } from "@/components/game/CardRailPreview";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { CardPreviewOverlay } from "./CardPreviewOverlay";
import { CardPreviewActions, type IndexedPreviewAction } from "./CardPreviewActions";
import { computePreviewLayout } from "./cardPreviewLayout";
import { getPreviewActionShortcut } from "./game.utils";
import { CARD_BACK_IMAGE_URL } from "./game.constants";
import { isFacelessCard } from "@/lib/gameCard";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { isHorizontalGameCard } from "@/lib/horizontalGameCard";
import { cn } from "@/lib/utils";
import { GHOST_CLICK_ARM_MS } from "@/lib/responsive";
import { PREVIEW_TIMING } from "@/lib/cardPreview";
import type { PreviewSide } from "./cardPreviewLayout";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { DEBUG_KEYWORD_CARD_ID, useGameDevStore } from "@/stores/useGameDevStore";
import { asDeckCard } from "@/lib/decks";
import { ScryfallImg } from "@/components/ScryfallImg";
import { useCardFaces } from "@/hooks/useCardFaces";
import { useKeybindings } from "@/hooks/useKeybindings";
import { deriveCardRailEffects, deriveCardRailState } from "@/components/game/cardRailState";

interface CardPreviewProps {
  card: CardDto;
  mouseX: number;
  mouseY: number;
  anchorRect?: DOMRect | null;
  placement?: "auto" | "top-center" | "pinned";
  phase?: "open" | "closing";
  suppressed?: boolean;
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

const SHIFT_BY_SIDE: Record<PreviewSide, { x: string; y: string }> = {
  right: { x: "-14px", y: "0px" },
  left: { x: "14px", y: "0px" },
  below: { x: "0px", y: "-14px" },
  above: { x: "0px", y: "14px" },
  center: { x: "0px", y: "0px" },
};

const ORIGIN_BY_SIDE: Record<PreviewSide, string> = {
  right: "left center",
  left: "right center",
  below: "center top",
  above: "center bottom",
  center: "center center",
};

const IMG_VERTICAL = "absolute inset-0 w-full h-full object-cover";
const IMG_HORIZONTAL =
  "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 origin-center h-[calc(100%*7/5)] aspect-[5/7] object-cover";

/**
 * Monotonic image display: pixels already on screen are never removed until
 * the replacement has finished loading. Swapping an `<img>` src blanks it
 * immediately, so a naive swap (face URLs resolving, low→high res, card
 * switch) flashes the preview empty for the load duration.
 */
function PreviewImageStack({
  targetUrl,
  lowResUrl,
  horizontal,
  cardName,
}: {
  targetUrl: string;
  lowResUrl: string | null;
  horizontal: boolean;
  cardName: string;
}) {
  const [displayed, setDisplayed] = useState<{ src: string; horizontal: boolean } | null>(null);
  const targetShown = displayed?.src === targetUrl;
  const showLowRes = !!lowResUrl && !targetShown && displayed?.src !== lowResUrl;
  return (
    <>
      {!displayed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 bg-black">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground text-center">{cardName}</span>
        </div>
      )}
      {displayed && !targetShown && (
        <ScryfallImg
          src={displayed.src}
          alt=""
          title=""
          aria-hidden
          className={displayed.horizontal ? IMG_HORIZONTAL : IMG_VERTICAL}
        />
      )}
      {showLowRes && (
        <ScryfallImg
          src={lowResUrl}
          alt=""
          title=""
          aria-hidden
          onLoad={() => setDisplayed({ src: lowResUrl, horizontal })}
          className={horizontal ? IMG_HORIZONTAL : IMG_VERTICAL}
        />
      )}
      <ScryfallImg
        src={targetUrl}
        alt={cardName}
        title=""
        onLoad={() => setDisplayed({ src: targetUrl, horizontal })}
        className={cn(horizontal ? IMG_HORIZONTAL : IMG_VERTICAL, !targetShown && "opacity-0")}
      />
    </>
  );
}

export function CardPreview({
  card,
  mouseX,
  mouseY,
  anchorRect,
  placement = "auto",
  phase = "open",
  suppressed = false,
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
  const hasActions = Boolean(actions?.length && onSelectAction);
  const themeColors = useTheme().gameTheme;
  const showHoverAreas = useGameDevStore((s) => s.showHoverAreas);
  const ringColor = themeColors.cardRing;
  const rail = deriveCardRailState(card);
  const nextClassLevel =
    rail?.kind === "class" && rail.current < rail.max ? rail.current + 1 : null;
  const availableActions = hasActions ? (actions ?? []) : [];
  const classLevelUpIndex = nextClassLevel
    ? availableActions.findIndex((action) => action.isClassLevelUp)
    : -1;
  const integratedClassLevelUpIndex = classLevelUpIndex >= 0 ? classLevelUpIndex : null;
  const indexedActions: IndexedPreviewAction[] = availableActions.map((action, index) => ({
    action,
    index,
    shortcut: getPreviewActionShortcut(
      index,
      integratedClassLevelUpIndex,
      integratedClassLevelUpIndex === null ? null : nextClassLevel,
    ),
  }));
  const classLevelUpActions = indexedActions.filter(({ action }) => action.isClassLevelUp);
  const railClassLevelUpAction =
    integratedClassLevelUpIndex === null ? undefined : indexedActions[integratedClassLevelUpIndex];
  const extraClassActions = railClassLevelUpAction
    ? classLevelUpActions.filter(({ index }) => index !== railClassLevelUpAction.index)
    : classLevelUpActions;
  const mainActions = indexedActions.filter(({ action }) => !action.isClassLevelUp);
  const railInteractions =
    nextClassLevel && railClassLevelUpAction
      ? [
          {
            position: nextClassLevel,
            shortcut: railClassLevelUpAction.shortcut,
            label: railClassLevelUpAction.action.label,
            onActivate: () => onSelectAction!(railClassLevelUpAction.action),
          },
        ]
      : [];
  const hasMainActions = mainActions.length > 0;
  const showSidePanel = hasMainActions || Boolean(rail || extraClassActions.length);
  const deck = useGameStore((s) => s.gameDecks[card.ownerId]);
  const isDebugCard = card.id === DEBUG_KEYWORD_CARD_ID;
  const deckCard: DeckCard = isDebugCard
    ? ({
        identity: { id: "", name: card.identity.name, setCode: "", cardNumber: "" },
        uris: {},
      } as DeckCard)
    : asDeckCard(deck, card);
  const { setCode, cardNumber } = deckCard.identity;
  const cardFaces = useCardFaces(
    isDebugCard
      ? { name: card.identity.name }
      : {
          name: card.identity.name,
          setCode: setCode || undefined,
          cardNumber: cardNumber || undefined,
        },
  );
  const front = cardFaces.faces[0];
  const back = cardFaces.faces[1];
  const railEffects = rail ? deriveCardRailEffects(card, rail) : [];
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [, setLayoutVersion] = useState(0);

  useLayoutEffect(() => {
    const update = () => setLayoutVersion((version) => version + 1);
    const observer = new ResizeObserver(update);
    if (slot) observer.observe(slot);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [slot]);

  useLayoutEffect(() => {
    const measure = () => setPanelHeight(panelRef.current?.offsetHeight ?? 0);
    const observer = new ResizeObserver(measure);
    if (panelRef.current) observer.observe(panelRef.current);
    const frame = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [showSidePanel, card.id]);

  const faceless = isFacelessCard(card);
  const imageUrl = faceless
    ? CARD_BACK_IMAGE_URL
    : deckCard.uris[imageSize] || front?.imageUris?.[imageSize];
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

  const horizontalCard = isDebugCard
    ? false
    : isHorizontalGameCard(card, deckCard.layout, showBackFace ? 1 : 0);
  const fallbackCounters =
    rail?.kind === "saga" && card.counters
      ? Object.fromEntries(
          Object.entries(card.counters).filter(([type, count]) => count > 0 && type !== "Lore"),
        )
      : card.counters;
  const [orientationFlipped, setOrientationFlipped] = useState(false);
  const [prevCardId, setPrevCardId] = useState(card.id);
  if (prevCardId !== card.id) {
    setPrevCardId(card.id);
    setOrientationFlipped(false);
  }

  useKeybindings({
    "flip-card": () => {
      if (horizontalCard) setOrientationFlipped((prev) => !prev);
      else if (onFlip && hasFlippableFaces) onFlip();
    },
  });

  useEffect(() => {
    if (!onDismiss) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onDismiss!();
        return;
      }
      if (!hasActions) return;
      const num = parseInt(e.key);
      const action = actions?.find(
        (_, index) =>
          getPreviewActionShortcut(
            index,
            integratedClassLevelUpIndex,
            integratedClassLevelUpIndex === null ? null : nextClassLevel,
          ) === num,
      );
      if (num >= 1 && num <= 9 && action) {
        e.preventDefault();
        onSelectAction!(action);
      }
    }
    function handleClick(e: PointerEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-card-preview]")) {
        onDismiss!();
      }
    }
    window.addEventListener("keydown", handleKey);
    const timer = setTimeout(() => {
      if (isSticky) {
        window.addEventListener("pointerdown", handleClick);
      }
    }, GHOST_CLICK_ARM_MS);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(timer);
      window.removeEventListener("pointerdown", handleClick);
    };
  }, [
    hasActions,
    isSticky,
    onDismiss,
    onSelectAction,
    actions,
    integratedClassLevelUpIndex,
    nextClassLevel,
  ]);

  const horizontal = horizontalCard && !orientationFlipped;
  const layout = computePreviewLayout({
    placement,
    anchorRect: anchorRect ?? null,
    mouseX,
    mouseY,
    horizontal,
    hasPanel: showSidePanel,
    panelHeight,
    slot: slot ?? null,
  });
  const { cardLeft, top, cardWidth, cardHeight, sidePanelWidth, panelSide } = layout;

  const hasDoubleFace = !!doubleFacedData;
  const currentImageUrl = hasDoubleFace && showBackFace ? doubleFacedData.backImageUrl : imageUrl;
  const currentCardName =
    hasDoubleFace && showBackFace ? doubleFacedData.backName : card.identity.name;
  const currentLowResUrl =
    imageSize !== "large"
      ? null
      : hasDoubleFace
        ? showBackFace
          ? doubleFacedData.backImageUrlLow
          : doubleFacedData.frontImageUrlLow
        : deckCard.uris.normal;
  const cardLookupPending = !isDebugCard && cardFaces.faces.length === 0;

  return createPortal(
    <>
      {hasActions && isSticky && !suppressed && (
        <div
          className="fixed inset-0 z-[9998] bg-black/30 animate-preview-fade-in"
          onClick={onDismiss}
        />
      )}
      <div
        data-card-preview
        className={cn(
          "select-none transition-opacity duration-150",
          suppressed && "opacity-0",
          slot
            ? "relative w-full h-full flex items-start justify-start pointer-events-none"
            : cn(
                "fixed z-[9999]",
                showSidePanel && placement !== "pinned" && !suppressed
                  ? "pointer-events-auto"
                  : "pointer-events-none",
              ),
        )}
        style={slot ? undefined : { left: cardLeft, top }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div
          className={cn(
            "relative @container",
            phase === "closing" ? "animate-preview-out" : "animate-preview-in",
          )}
          style={
            {
              ["--card-rail-width" as string]: CARD_RAIL_WIDTH,
              ["--preview-shift-x" as string]: SHIFT_BY_SIDE[layout.side].x,
              ["--preview-shift-y" as string]: SHIFT_BY_SIDE[layout.side].y,
              transformOrigin: ORIGIN_BY_SIDE[layout.side],
              animationDuration: `${phase === "closing" ? PREVIEW_TIMING.exitMs : PREVIEW_TIMING.enterMs}ms`,
              width: cardWidth,
              height: cardHeight,
              marginLeft: slot ? layout.slotMarginLeft : undefined,
            } as CSSProperties
          }
        >
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
                <PreviewImageStack
                  targetUrl={currentImageUrl}
                  lowResUrl={currentLowResUrl ?? null}
                  horizontal={horizontal}
                  cardName={currentCardName}
                />
                <CardPreviewOverlay
                  card={card}
                  horizontal={horizontal}
                  rail={rail}
                  compactRail={false}
                />
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
                    className="absolute top-2 right-2 z-20 inline-flex items-center gap-1 rounded-full bg-black/65 hover:bg-black/85 text-white text-[10px] font-semibold uppercase tracking-wide px-2 py-1 pointer-coarse:px-3 pointer-coarse:py-2 shadow pointer-events-auto"
                    title={`Flip card (F) — ${showBackFace ? doubleFacedData.frontName : doubleFacedData.backName}`}
                  >
                    <RotateCw className="h-3 w-3" />
                    {showBackFace ? "Front" : "Back"}
                  </button>
                )}
                {horizontalCard && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOrientationFlipped((prev) => !prev);
                    }}
                    className="absolute top-2 left-2 z-20 inline-flex items-center gap-1 rounded-full bg-black/65 hover:bg-black/85 text-white text-[10px] font-semibold uppercase tracking-wide px-2 py-1 pointer-coarse:px-3 pointer-coarse:py-2 shadow pointer-events-auto"
                    title="Rotate the card to read it (F)"
                  >
                    <RotateCw className="h-3 w-3" />
                    {orientationFlipped ? "Read" : "Rotate"}
                  </button>
                )}
              </>
            ) : cardLookupPending ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 bg-black">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground text-center">{currentCardName}</span>
              </div>
            ) : (
              <div className="w-full h-full p-4 bg-card">
                <div className="flex h-full min-w-0 flex-col gap-2">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-bold text-sm leading-tight">{currentCardName}</span>
                    {!hasDoubleFace &&
                      (card.effectiveManaCost ? (
                        <div className="flex flex-col items-end">
                          <span className="line-through opacity-50">
                            <ManaSymbols cost={card.manaCost} size="md" />
                          </span>
                          <span
                            className="rounded border px-0.5"
                            style={{ borderColor: ringColor }}
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
                  {fallbackCounters && <CounterDisplay counters={fallbackCounters} size="md" />}
                  {card.power && card.toughness && (
                    <div className="text-right font-bold text-sm">
                      {card.power}/{card.toughness}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {showSidePanel && (
            <div
              ref={panelRef}
              className="absolute top-0 flex flex-col gap-1.5"
              style={{
                ...(panelSide === "right" ? { left: cardWidth + 10 } : { right: cardWidth + 10 }),
                width: sidePanelWidth,
                transform: `scale(${layout.panelScale})`,
                transformOrigin: panelSide === "right" ? "top left" : "top right",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  ...(panelSide === "right"
                    ? { left: -10 - cardWidth, borderBottomRightRadius: "100%" }
                    : { right: -10 - cardWidth, borderBottomLeftRadius: "100%" }),
                  width: cardWidth + 10 + sidePanelWidth,
                  height: cardHeight,
                  backgroundColor: showHoverAreas
                    ? withAlpha(themeColors.success, 0.28)
                    : "transparent",
                  zIndex: -1,
                }}
              />
              {hasMainActions && (
                <CardPreviewActions
                  actions={mainActions}
                  onSelect={onSelectAction!}
                  ringColor={ringColor}
                  showHelp
                  hasFlippableFaces={hasFlippableFaces}
                />
              )}
              {rail && (
                <CardRailPreview
                  state={rail}
                  effects={railEffects}
                  interactions={railInteractions}
                />
              )}
              {extraClassActions.length > 0 && (
                <CardPreviewActions
                  actions={extraClassActions}
                  onSelect={onSelectAction!}
                  ringColor={ringColor}
                  showHelp={!hasMainActions}
                  hasFlippableFaces={hasFlippableFaces}
                />
              )}
              {!hasActions && hasFlippableFaces && (
                <div className="px-1 text-[10px] text-muted-foreground">
                  <span>
                    <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">
                      F
                    </kbd>{" "}
                    flip
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    slot ?? document.body,
  );
}

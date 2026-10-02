import { topModal } from "@/lib/modalStack";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Loader2, RotateCw } from "lucide-react";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import { CounterDisplay } from "@/components/game/CounterBadge";
import { CARD_RAIL_WIDTH } from "@/components/game/CardRail";
import { CardRailPreview } from "@/components/game/CardRailPreview";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { CardPreviewOverlay } from "./CardPreviewOverlay";
import { GameIcon } from "./GameIcon";
import { CardPreviewActions, type IndexedPreviewAction } from "./CardPreviewActions";
import { ACTIONABLE_CARD_GLOW_CLASS, actionableCardGlowStyle } from "./cardPreviewStyles";
import { computePreviewLayout } from "./cardPreviewLayout";
import { getPreviewActionShortcut } from "./game.utils";
import { CARD_W, CARD_RADIUS } from "./game.constants";
import { CARD_BACK_IMAGE_URL } from "./game.constants";
import { isFacelessCard } from "@/lib/gameCard";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { isHorizontalGameCard } from "@/lib/horizontalGameCard";
import { cn } from "@/lib/utils";
import { GHOST_CLICK_ARM_MS } from "@/lib/responsive";
import { PREVIEW_TIMING, type PreviewFlipOptions } from "@/lib/cardPreview";
import { CARD_PREVIEW_EVENT_HANDLERS } from "@/lib/cardPreviewEvents";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { DEBUG_KEYWORD_CARD_ID, useGameDevStore } from "@/stores/useGameDevStore";
import { ScryfallImg } from "@/components/ScryfallImg";
import { useResolvedGameCard } from "@/hooks/useResolvedGameCard";
import { useKeybindings } from "@/hooks/useKeybindings";
import { deriveCardRailEffects, deriveCardRailState } from "@/components/game/cardRailState";
import { cardTypeLine, replaceCardName } from "@/components/game/cardPresentation";
import { localizeRulesPreviewText } from "@/pixi/cardPreview/rulesCardPreviewPresentation";
import { CardPreviewHoverArea } from "./CardPreviewHoverArea";
interface CardPreviewProps {
  card: CardDto;
  mouseX: number;
  mouseY: number;
  anchorRect?: DOMRect | null;
  placement?: "auto" | "top-center" | "pinned";
  viewportRight?: number;
  phase?: "open" | "closing";
  suppressed?: boolean;
  showBackFace?: boolean;
  skipEnterAnimation?: boolean;
  actions?: HandActionOption[];
  onSelectAction?: (action: HandActionOption) => void;
  onDismiss?: () => void;
  onFlip?: (options?: PreviewFlipOptions) => void;
  onToggleView?: () => void;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isSticky?: boolean;
  slot?: HTMLElement | null;
  portalTarget?: HTMLElement | null;
  imageSize?: "normal" | "large";
}
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
  const [displayed, setDisplayed] = useState<{
    src: string;
    horizontal: boolean;
  } | null>(null);
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
  viewportRight,
  phase = "open",
  suppressed = false,
  skipEnterAnimation = false,
  showBackFace = false,
  actions,
  onSelectAction,
  onDismiss,
  onFlip,
  onToggleView,
  onNavigatePrevious,
  onNavigateNext,
  onMouseEnter,
  onMouseLeave,
  isSticky = false,
  slot,
  imageSize = "large",
  portalTarget,
}: CardPreviewProps) {
  const resolvedGameCard = useResolvedGameCard(card);
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
    displayLabel: localizeRulesPreviewText(
      action.label,
      resolvedGameCard.info,
      card.isTransformed ? 1 : 0,
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
            label: railClassLevelUpAction.displayLabel,
            onActivate: () => onSelectAction!(railClassLevelUpAction.action),
          },
        ]
      : [];
  const hasMainActions = mainActions.length > 0;
  const showSidePanel = hasMainActions || Boolean(rail || extraClassActions.length);
  const isDebugCard = card.id === DEBUG_KEYWORD_CARD_ID;
  const deckCard: DeckCard = isDebugCard
    ? ({
        identity: { id: "", name: card.identity.name, setCode: "", cardNumber: "" },
        uris: {},
      } as DeckCard)
    : resolvedGameCard.deckCard;
  const cardFaces = resolvedGameCard.cardFaces;
  const resolveImageUrl = resolvedGameCard.imageUrl;
  const front = cardFaces.faces[0];
  const back = cardFaces.faces[1];
  const previewFaceIndex = showBackFace ? 1 : 0;
  const railEffects = rail ? deriveCardRailEffects(card, rail) : [];
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [, setLayoutVersion] = useState(0);
  const [slotBounds, setSlotBounds] = useState<DOMRect | null>(null);
  // The hero zoom travels across the hovered card; an interactive preview
  // passing under the cursor steals pointer events from the canvas and kills
  // the sprite's hover state. Stay pointer-transparent until the enter lands.
  const [entered, setEntered] = useState(skipEnterAnimation);
  const interactive = entered && phase === "open" && !suppressed;
  useEffect(() => {
    if (skipEnterAnimation) return;
    const timer = setTimeout(() => setEntered(true), PREVIEW_TIMING.enterMs + 80);
    return () => clearTimeout(timer);
  }, [skipEnterAnimation]);
  useLayoutEffect(() => {
    const update = () => {
      if (slot) {
        setSlotBounds(rootRef.current?.getBoundingClientRect() ?? slot.getBoundingClientRect());
      }
      setLayoutVersion((version) => version + 1);
    };
    const observer = new ResizeObserver(update);
    if (slot) observer.observe(slot);
    if (slot) update();
    window.addEventListener("resize", update);
    if (slot) window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [slot]);
  useLayoutEffect(() => {
    const measure = () => setPanelHeight(panelRef.current?.offsetHeight ?? 0);
    const observer = new ResizeObserver(measure);
    if (panelRef.current) observer.observe(panelRef.current);
    measure();
    return () => {
      observer.disconnect();
    };
  }, [showSidePanel, card.id]);
  const faceless = isFacelessCard(card);
  const imageUrl = faceless ? CARD_BACK_IMAGE_URL : resolveImageUrl(0, imageSize);
  const frontImageUrl = resolveImageUrl(0, imageSize);
  const backImageUrl = resolveImageUrl(1, imageSize);
  const hasFlippableFaces = cardFaces.isFlippable && !!frontImageUrl && !!backImageUrl;
  const doubleFacedData = hasFlippableFaces
    ? {
        frontImageUrl: frontImageUrl!,
        backImageUrl: backImageUrl!,
        frontImageUrlLow: resolveImageUrl(0, "normal")!,
        backImageUrlLow: resolveImageUrl(1, "normal")!,
        frontName: front!.name,
        backName: back!.name,
      }
    : null;
  const horizontalCard = isDebugCard
    ? false
    : isHorizontalGameCard(
        card,
        deckCard.layout,
        previewFaceIndex,
        cardFaces.faces[previewFaceIndex]?.typeLine,
      );
  const fallbackCounters =
    rail?.kind === "saga" && card.counters
      ? Object.fromEntries(
          Object.entries(card.counters).filter(([type, count]) => count > 0 && type !== "Lore"),
        )
      : card.counters;
  useKeybindings(
    onFlip && hasFlippableFaces ? { "flip-card": () => onFlip() } : {},
    portalTarget ? rootRef : undefined,
  );
  useEffect(() => {
    if (!onDismiss) return;
    function handleKey(e: KeyboardEvent) {
      const modal = topModal();
      if (e.defaultPrevented || e.isComposing || (modal && modal !== portalTarget)) return;
      if (e.key === "Escape") {
        if (modal) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
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
    function handleOutsidePointerDown(e: PointerEvent) {
      const target = e.target;
      if (target instanceof Element && target.closest("[data-card-preview]")) return;
      if (e.pointerType === "touch") {
        const pointerId = e.pointerId;
        const suppressClick = (click: MouseEvent) => {
          if (click.detail === 0) return;
          if (click instanceof PointerEvent && click.pointerId !== pointerId) return;
          click.preventDefault();
          click.stopImmediatePropagation();
          window.removeEventListener("click", suppressClick, true);
        };
        window.addEventListener("click", suppressClick, true);
        window.setTimeout(() => window.removeEventListener("click", suppressClick, true), 500);
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      onDismiss!();
    }
    window.addEventListener("keydown", handleKey, { capture: !!portalTarget });
    const timer = setTimeout(() => {
      if (isSticky) window.addEventListener("pointerdown", handleOutsidePointerDown, true);
    }, GHOST_CLICK_ARM_MS);
    return () => {
      window.removeEventListener("keydown", handleKey, { capture: !!portalTarget });
      clearTimeout(timer);
      window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    };
  }, [
    hasActions,
    isSticky,
    onDismiss,
    onSelectAction,
    actions,
    integratedClassLevelUpIndex,
    nextClassLevel,
    portalTarget,
  ]);
  const horizontal = horizontalCard;
  const layout = computePreviewLayout({
    placement,
    anchorRect: anchorRect ?? null,
    mouseX,
    mouseY,
    horizontal,
    hasPanel: showSidePanel,
    panelHeight,
    viewportRight,
    slot: slot ?? null,
  });
  const { cardLeft, top, cardWidth, cardHeight, sidePanelWidth, panelSide } = layout;
  const cardCornerRadius = (Math.min(cardWidth, cardHeight) * CARD_RADIUS) / CARD_W;
  const anchorCenterX = anchorRect ? anchorRect.left + anchorRect.width / 2 : mouseX;
  const anchorCenterY = anchorRect ? anchorRect.top + anchorRect.height / 2 : mouseY;
  const heroShiftX = slot ? 0 : anchorCenterX - (cardLeft + cardWidth / 2);
  const heroShiftY = slot ? 0 : anchorCenterY - (top + cardHeight / 2);
  const heroScaleFrom = slot
    ? 0.95
    : anchorRect
      ? Math.max(0.25, Math.min(0.85, anchorRect.width / Math.max(1, cardWidth)))
      : 0.5;
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
        : resolveImageUrl(0, "normal");
  const cardLookupPending = !isDebugCard && cardFaces.faces.length === 0;
  const hasPreviewControls = Boolean(onToggleView || (hasDoubleFace && onFlip) || isSticky);
  const handlePreviewPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!isSticky || event.pointerType !== "touch") return;
    swipeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePreviewPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    if (horizontal && Math.abs(dx) >= 48) {
      if (dx > 0) onNavigatePrevious?.();
      else onNavigateNext?.();
      event.preventDefault();
      return;
    }
    if (!horizontal && dy >= 64) {
      onDismiss?.();
      event.preventDefault();
      return;
    }
    if (!horizontal && dy <= -64) {
      if (hasDoubleFace && onFlip) onFlip();
      else onToggleView?.();
      event.preventDefault();
    }
  };
  return createPortal(
    <>
      {hasActions && isSticky && !suppressed && (
        <div
          className="fixed inset-0 z-[9998] bg-black/30 animate-preview-fade-in"
          onClick={onDismiss}
        />
      )}
      {phase === "open" && !suppressed && placement !== "pinned" && (
        <CardPreviewHoverArea
          source={anchorRect ?? null}
          cardLeft={
            slot
              ? (slotBounds?.left ?? slot.getBoundingClientRect().left) + layout.slotMarginLeft
              : cardLeft
          }
          cardTop={slot ? (slotBounds?.top ?? slot.getBoundingClientRect().top) : top}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          panelWidth={showSidePanel ? sidePanelWidth * layout.panelScale : 0}
          panelHeight={panelHeight * layout.panelScale}
          panelSide={panelSide}
          sticky={isSticky}
          contentInteractive={Boolean(slot) && interactive}
          debugColor={showHoverAreas ? withAlpha(themeColors.success, 0.28) : undefined}
          portalTarget={portalTarget}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        />
      )}
      <div
        ref={rootRef}
        {...CARD_PREVIEW_EVENT_HANDLERS}
        data-card-preview
        className={cn(
          "select-none transition-opacity duration-150",
          suppressed && "opacity-0",
          slot
            ? "relative w-full h-full flex items-start justify-start pointer-events-none"
            : cn(
                "fixed z-[10001]",
                placement !== "pinned" && interactive && (showSidePanel || hasPreviewControls)
                  ? "pointer-events-auto"
                  : "pointer-events-none",
              ),
        )}
        style={
          slot ? undefined : { left: cardLeft, top, touchAction: isSticky ? "none" : undefined }
        }
        onPointerDown={handlePreviewPointerDown}
        onPointerUp={handlePreviewPointerUp}
        onPointerCancel={(event) => {
          event.stopPropagation();
          swipeRef.current = null;
        }}
        onMouseEnter={(event) => {
          event.stopPropagation();
          if (placement === "pinned") onMouseEnter?.();
        }}
        onMouseLeave={(event) => {
          event.stopPropagation();
          if (placement === "pinned") onMouseLeave?.();
        }}
      >
        <div
          className={cn(
            "relative @container",
            phase === "closing"
              ? "animate-preview-out"
              : !skipEnterAnimation && "animate-preview-in",
          )}
          style={
            {
              ["--card-rail-width" as string]: CARD_RAIL_WIDTH,
              ["--preview-shift-x" as string]: `${heroShiftX}px`,
              ["--preview-shift-y" as string]: `${heroShiftY}px`,
              ["--preview-scale-from" as string]: `${heroScaleFrom}`,
              animationDuration: `${phase === "closing" ? PREVIEW_TIMING.exitMs : PREVIEW_TIMING.enterMs}ms`,
              width: cardWidth,
              height: cardHeight,
              marginLeft: slot ? layout.slotMarginLeft : undefined,
              pointerEvents: slot ? (interactive ? "auto" : "none") : undefined,
            } as CSSProperties
          }
        >
          <div
            className={cn(
              "w-full h-full shadow-2xl overflow-hidden bg-black relative",
              hasActions && ACTIONABLE_CARD_GLOW_CLASS,
              card.foil && "draft-tile-foil",
            )}
            style={{
              borderRadius: cardCornerRadius,
              ...(hasActions ? actionableCardGlowStyle(ringColor) : {}),
            }}
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
                {hasPreviewControls && (
                  <div className="absolute top-[12%] right-2 z-20 flex items-center gap-1">
                    {onToggleView && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleView();
                        }}
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white shadow hover:bg-black/85 pointer-coarse:h-11 pointer-coarse:w-11",
                          interactive ? "pointer-events-auto" : "pointer-events-none",
                        )}
                        aria-label={`Show rules`}
                        title={`Show rules (R)`}
                      >
                        <GameIcon name="spell-book" className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {hasDoubleFace && onFlip && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onFlip({ sticky: true });
                        }}
                        className={cn(
                          "inline-flex min-h-8 items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white shadow hover:bg-black/85 pointer-coarse:min-h-11 pointer-coarse:px-3",
                          interactive ? "pointer-events-auto" : "pointer-events-none",
                        )}
                        title={`Flip card (F) — ${showBackFace ? doubleFacedData.frontName : doubleFacedData.backName}`}
                      >
                        <RotateCw className="h-3 w-3" />
                        {showBackFace ? `Front` : `Back`}
                      </button>
                    )}
                  </div>
                )}
                {isSticky && (onNavigatePrevious || onNavigateNext) && (
                  <div className="absolute inset-x-2 bottom-2 z-20 flex items-center justify-between">
                    <button
                      type="button"
                      aria-label="Previous card"
                      disabled={!onNavigatePrevious}
                      onClick={(event) => {
                        event.stopPropagation();
                        onNavigatePrevious?.();
                      }}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white shadow disabled:opacity-30"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next card"
                      disabled={!onNavigateNext}
                      onClick={(event) => {
                        event.stopPropagation();
                        onNavigateNext?.();
                      }}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white shadow disabled:opacity-30"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
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
                    <div className="text-xs text-muted-foreground">{cardTypeLine(card)}</div>
                  )}
                  <div className="flex-1 text-xs text-foreground/80 whitespace-pre-wrap">
                    {hasDoubleFace && showBackFace
                      ? `Back face: ${doubleFacedData!.backName}`
                      : hasDoubleFace && !showBackFace
                        ? `Front face: ${doubleFacedData!.frontName}`
                        : replaceCardName(card.text, card.identity.name)}
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
                pointerEvents: interactive ? "auto" : "none",
              }}
            >
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
    slot ?? portalTarget ?? document.body,
  );
}

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { GAME_CARD_SIZES } from "@/components/game/game.constants";
import { CardHoverPreview } from "@/components/game/CardHoverPreview";
import { LimitedBoosterOverlay } from "@/components/limited/LimitedBoosterOverlay";
import { useCardPreview } from "@/hooks/useCardPreview";
import { refToDeckCard } from "@/lib/limited.utils";
import { deckCardToPreviewDto } from "@/lib/scryfall.utils";
import { cn } from "@/lib/utils";
import { LimitedCardScene } from "@/pixi/limited/LimitedCardScene";
import type {
  BoosterOpeningState,
  BoosterOpeningPacket,
  BoosterTearDirection,
} from "@/pixi/limited/LimitedBoosterReveal";
import {
  limitedLayout,
  type LimitedGrouping,
  type LimitedLayoutOptions,
} from "@/pixi/limited/limitedLayout";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import type { DraftCard } from "@/types/limited";

export interface LimitedCardCanvasProps {
  cards: DraftCard[];
  selectedIds?: readonly string[];
  onSelect?: (card: DraftCard, additive: boolean) => void;
  onSelectMany?: (ids: string[]) => void;
  onActivate?: (card: DraftCard) => void;
  onDrop?: (card: DraftCard, clientX: number, clientY: number) => void;
  disabled?: boolean;
  cardSize?: number;
  groupBy?: LimitedGrouping;
  className?: string;
  arrivalKey?: string;
  opening?: boolean;
  openingPackCount?: number;
  openingSetCode?: string;
  openingCardIds?: readonly string[];
  openingPackets?: readonly BoosterOpeningPacket[];
  openingTearDirection?: BoosterTearDirection;
  onOpeningComplete?: () => void;
  onSkipOpening?: () => void;
  presentation?: LimitedLayoutOptions["presentation"];
  arrivalDirection?: "left" | "right";
  acquiredIds?: readonly string[];
  departureTarget?: () => HTMLElement | null;
  emptyMessage?: string;
  previewPortalTarget?: HTMLElement | null;
}
const NO_SELECTION: readonly string[] = [];
export function LimitedCardCanvas({
  cards,
  selectedIds = NO_SELECTION,
  onSelect,
  onSelectMany,
  onActivate,
  onDrop,
  disabled = false,
  cardSize = GAME_CARD_SIZES.hand.width,
  groupBy = "none",
  className,
  arrivalKey,
  opening = false,
  openingPackCount = 1,
  openingSetCode,
  openingCardIds,
  openingPackets,
  openingTearDirection,
  onOpeningComplete,
  onSkipOpening,
  presentation = "grid",
  arrivalDirection,
  acquiredIds,
  departureTarget,
  emptyMessage = "No cards in this zone.",
  previewPortalTarget,
}: LimitedCardCanvasProps) {
  const scrollHost = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const scene = useRef<LimitedCardScene | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [scrollTop, setScrollTop] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [booster, setBooster] = useState<{
    arrivalKey: string | undefined;
    state: BoosterOpeningState | null;
  } | null>(null);
  const openingRequest = useRef({ arrivalKey, opening, onOpeningComplete });
  const fallbackOpening = useRef<{ arrivalKey: string | undefined } | null>(null);
  useLayoutEffect(() => {
    openingRequest.current = { arrivalKey, opening, onOpeningComplete };
  });
  const handleOpeningChange = useCallback((state: BoosterOpeningState | null) => {
    setBooster({ arrivalKey: openingRequest.current.arrivalKey, state });
  }, []);
  const handleOpeningComplete = useCallback(() => {
    openingRequest.current.onOpeningComplete?.();
  }, []);
  const openBooster = useCallback(() => scene.current?.openBooster(), []);
  const tearBooster = useCallback(
    (progress: number, direction?: BoosterTearDirection) =>
      scene.current?.tearBooster(progress, direction),
    [],
  );
  const skipBooster = useCallback(() => scene.current?.skipBooster(), []);
  const openingActive = opening && !error;
  const openingState = booster && booster.arrivalKey === arrivalKey ? booster.state : null;
  const instructionsId = useId();
  const activeFocusedId = cards.some((card) => card.id === focusedId) ? focusedId : null;
  const inspectionRequest = useRef(0);
  const bucket = useScryfallStore((state) => state.cards);
  const locale = useScryfallStore((state) => state.locale);
  const sets = useScryfallStore((state) => state.sets);
  const packSetCode = useMemo(() => {
    if (openingSetCode) return openingSetCode.toLowerCase();
    if (!opening) return undefined;
    const counts = new Map<string, number>();
    let largest = 0;
    let cardCount = 0;
    let code: string | undefined;
    const openingIds = openingCardIds ? new Set(openingCardIds) : null;
    for (const card of cards) {
      if (openingIds && !openingIds.has(card.id)) continue;
      cardCount += 1;
      const setCode = card.setCode.toLowerCase();
      const count = (counts.get(setCode) ?? 0) + 1;
      counts.set(setCode, count);
      if (count > largest) {
        largest = count;
        code = setCode;
      }
    }
    return largest > cardCount / 2 ? code : undefined;
  }, [cards, opening, openingSetCode, openingCardIds]);
  const openingSet = sets.find((set) => set.code === packSetCode);
  const preview = useCardPreview([cards, locale]);
  const {
    dismiss: dismissPreview,
    getSnapshot,
    handleMouseEnter,
    handleMouseLeave,
    showSticky,
    claimOwnership,
  } = preview;
  const dismiss = useCallback(() => {
    inspectionRequest.current += 1;
    dismissPreview();
  }, [dismissPreview]);
  useLayoutEffect(
    () => () => {
      inspectionRequest.current += 1;
    },
    [cards, locale],
  );
  const layout = useMemo(
    () =>
      limitedLayout(
        cards,
        viewport.width,
        presentation === "spread" ? Math.max(cardSize, GAME_CARD_SIZES.prompt.width) : cardSize,
        groupBy,
        (card) =>
          peekCard(bucket, {
            name: card.name,
            setCode: card.setCode,
            collectorNumber: card.cardNumber,
          }),
        { presentation, height: viewport.height },
      ),
    [cards, viewport.width, viewport.height, cardSize, groupBy, bucket, presentation],
  );
  const inspect = useCallback(
    (card: DraftCard | null, sticky: boolean) => {
      if (getSnapshot().sticky && !sticky) return;
      const request = ++inspectionRequest.current;
      if (!card) {
        handleMouseLeave();
        return;
      }
      const ownsPreview = claimOwnership();
      const anchor = buttons.current.get(card.id)?.getBoundingClientRect();
      void useScryfallStore
        .getState()
        .getCard({ name: card.name, setCode: card.setCode, collectorNumber: card.cardNumber })
        .then((entry) => {
          if (request !== inspectionRequest.current || !ownsPreview()) return;
          const dto = deckCardToPreviewDto(refToDeckCard(card, entry));
          if (sticky) showSticky(dto, undefined, undefined, anchor);
          else handleMouseEnter(dto, undefined, { anchorOverride: anchor, useDelay: true });
        })
        .catch(() => undefined);
    },
    [getSnapshot, handleMouseEnter, handleMouseLeave, showSticky, claimOwnership],
  );
  const props = {
    layout,
    ...viewport,
    scrollTop,
    selectedIds,
    disabled,
    arrivalKey,
    opening,
    openingPackCount,
    openingSetCode: packSetCode,
    openingSet,
    openingCardIds,
    openingPackets,
    openingTearDirection,
    onOpeningChange: handleOpeningChange,
    onOpeningComplete: handleOpeningComplete,
    arrivalDirection,
    acquiredIds,
    departureTarget,
    onSelect,
    onSelectMany,
    onActivate,
    onDrop,
    onInspect: inspect,
  };
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    const host = scrollHost.current;
    if (!host) return;
    const observer = new ResizeObserver(() =>
      setViewport({ width: host.clientWidth, height: host.clientHeight }),
    );
    observer.observe(host);
    setViewport({ width: host.clientWidth, height: host.clientHeight });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    const current = new LimitedCardScene(host, latest.current, setError);
    scene.current = current;
    void current.init();
    return () => {
      current.destroy();
      scene.current = null;
      dismiss();
    };
  }, [dismiss]);
  useEffect(() => {
    scene.current?.update(props);
  });
  useEffect(() => {
    if (!opening) {
      fallbackOpening.current = null;
      return;
    }
    if (!error || (fallbackOpening.current && fallbackOpening.current.arrivalKey === arrivalKey))
      return;
    fallbackOpening.current = { arrivalKey };
    openingRequest.current.onOpeningComplete?.();
  }, [error, opening, arrivalKey]);
  useEffect(() => {
    if (groupBy === "none") return;
    for (const card of cards)
      void useScryfallStore
        .getState()
        .getCard({ name: card.name, setCode: card.setCode, collectorNumber: card.cardNumber })
        .catch(() => undefined);
  }, [cards, groupBy, locale]);
  const focusCard = (index: number) => {
    const cell = layout.cells[Math.max(0, Math.min(layout.cells.length - 1, index))];
    if (!cell || !scrollHost.current) return;
    const host = scrollHost.current;
    if (cell.y < host.scrollTop) host.scrollTop = cell.y;
    else if (cell.y + cell.height > host.scrollTop + host.clientHeight)
      host.scrollTop = cell.y + cell.height - host.clientHeight;
    buttons.current.get(cell.card.id)?.focus({ preventScroll: true });
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (openingActive) {
      event.preventDefault();
      return;
    }
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      if (presentation === "grid") {
        const offset =
          event.key === "ArrowLeft"
            ? -1
            : event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowUp"
                ? -layout.columns
                : layout.columns;
        focusCard(index + offset);
        return;
      }
      const current = layout.cells[index];
      const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      let nextIndex = index;
      let bestCross = Infinity;
      let bestAlong = Infinity;
      for (let candidateIndex = 0; candidateIndex < layout.cells.length; candidateIndex++) {
        const candidate = layout.cells[candidateIndex];
        const dx = candidate.x + candidate.width / 2 - current.x - current.width / 2;
        const dy = candidate.y + candidate.height / 2 - current.y - current.height / 2;
        const along = (horizontal ? dx : dy) * direction;
        if (along <= 0) continue;
        const cross = Math.abs(horizontal ? dy : dx);
        if (cross < bestCross || (cross === bestCross && along < bestAlong)) {
          nextIndex = candidateIndex;
          bestCross = cross;
          bestAlong = along;
        }
      }
      focusCard(nextIndex);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusCard(event.key === "Home" ? 0 : layout.cells.length - 1);
    } else if (event.key === "Enter" && onActivate) {
      event.preventDefault();
      scene.current?.skipBooster();
      onActivate(layout.cells[index].card);
    } else if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      inspect(layout.cells[index].card, true);
    } else if (event.key === "Escape") {
      scene.current?.skipBooster();
      scene.current?.abort();
      dismiss();
    }
  };
  return (
    <div className={cn("relative flex min-h-0 flex-col", className)}>
      <p id={instructionsId} className="sr-only">
        Select a card. Enter to activate. Hover or hold to preview. I to pin. Use arrow keys to move
        between cards.
      </p>
      {error && (
        <p role="status" className="px-3 text-sm text-muted-foreground">
          Card canvas unavailable. Use the card controls below. {error}
        </p>
      )}
      <div
        ref={scrollHost}
        onPointerDown={(event) => {
          if (openingActive) return;
          if (event.target instanceof Element && event.target.closest("button")) return;
          dismiss();
          scene.current?.pressMarquee(event.nativeEvent);
        }}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          inspectionRequest.current += 1;
          if (!preview.getSnapshot().sticky) preview.dismiss();
        }}
        className={cn(
          "relative min-h-0 flex-1 overflow-y-auto overscroll-contain",
          onSelectMany && "cursor-crosshair",
        )}
      >
        <div className="relative" style={{ height: Math.max(viewport.height, layout.height) }}>
          <div
            ref={canvasHost}
            className={cn(
              "pointer-events-none sticky top-0 z-[3] overflow-hidden",
              error && "invisible",
            )}
            style={{ height: viewport.height }}
          />
          {layout.cells.map((cell, index) => (
            <button
              key={cell.card.id}
              ref={(node) => {
                if (node) buttons.current.set(cell.card.id, node);
                else buttons.current.delete(cell.card.id);
              }}
              type="button"
              data-limited-card-id={cell.card.id}
              disabled={disabled || openingActive}
              aria-label={`${cell.card.name}, ${cell.card.setCode}, ${cell.card.cardNumber}, copy ${index + 1}`}
              aria-describedby={instructionsId}
              aria-pressed={selectedIds.includes(cell.card.id)}
              tabIndex={
                !openingActive && cell.card.id === (activeFocusedId ?? layout.cells[0]?.card.id)
                  ? 0
                  : -1
              }
              onFocus={() => setFocusedId(cell.card.id)}
              onKeyDown={(event) => keyboard(event, index)}
              onPointerDown={(event) => {
                if (openingActive) return;
                dismiss();
                scene.current?.pressCard(cell.card.id, event.nativeEvent);
              }}
              onPointerEnter={(event) => {
                if (!openingActive) scene.current?.hoverCard(cell.card.id, event.pointerType);
              }}
              onPointerLeave={(event) => {
                if (!openingActive) scene.current?.hoverCard(null, event.pointerType);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (openingActive) return;
                inspect(cell.card, true);
              }}
              onClick={(event) => {
                if (openingActive) return;
                if (event.detail === 0 || error) {
                  scene.current?.skipBooster();
                  onSelect?.(cell.card, event.ctrlKey || event.metaKey || event.shiftKey);
                }
              }}
              onDoubleClick={() => {
                if (!openingActive && error) onActivate?.(cell.card);
              }}
              className={cn(
                "absolute z-[2] cursor-pointer rounded-md p-2 text-sm opacity-0 focus-visible:opacity-100 focus-visible:bg-card focus-visible:text-card-foreground focus-visible:outline-2 focus-visible:outline-primary",
                onDrop && "cursor-grab active:cursor-grabbing",
                error && "bg-card opacity-100",
                selectedIds.includes(cell.card.id) && "ring-2 ring-selection",
              )}
              style={{
                left: cell.x,
                top: cell.y,
                width: cell.width,
                height: cell.height,
                touchAction: onDrop ? "none" : "pan-y",
              }}
            >
              {cell.card.name}
            </button>
          ))}
          {!cards.length && (
            <p
              role="status"
              className="absolute inset-x-0 top-8 text-center text-sm text-muted-foreground"
            >
              {emptyMessage}
            </p>
          )}
        </div>
      </div>
      {openingActive && !openingPackets && (
        <LimitedBoosterOverlay
          key={arrivalKey}
          state={openingState}
          onOpen={openBooster}
          onTear={tearBooster}
          onSkip={skipBooster}
          onSkipOpening={onSkipOpening}
        />
      )}
      <CardHoverPreview preview={{ ...preview, dismiss }} portalTarget={previewPortalTarget} />
    </div>
  );
}

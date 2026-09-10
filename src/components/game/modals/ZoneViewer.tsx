import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import type { CardDto } from "@/protocol/game";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/hooks/useTheme";
import { useKeybindings } from "@/hooks/useKeybindings";
import { isFacelessCard } from "@/lib/gameCard";
import { zoneLocationKey, type ZoneLocation, type ZoneViewMode } from "@/lib/zoneView";
import { cn } from "@/lib/utils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { useGameUIStore } from "@/stores/useGameUIStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { CardInspectionState } from "./cardInspection";
import {
  cardSearchText,
  INITIAL_CARD_BROWSER_STATE,
  type CardBrowserItem,
  type CardBrowserState,
} from "./cardBrowser";
import { FullscreenPrompt } from "./FullscreenPrompt";
import { ZoneBrowserCanvas, type ZoneBrowserCanvasHandle } from "./ZoneBrowserCanvas";
import { useBrowserSearchItems } from "./useBrowserSearchItems";

export interface ZoneViewerProps {
  title: string;
  cards: CardDto[];
  mode: ZoneViewMode;
  source?: ZoneLocation;
  totalCount?: number;
  pending?: boolean;
  onClose: () => void;
  onClickCard?: (cardId: string) => void;
  clickableCardIds?: string[];
  selectedCardIds?: string[];
  clickLabel?: string;
  selectedLabel?: string;
  targetHostile?: boolean;
}

const ACTION_LABELS: Record<ZoneViewMode, string> = {
  browse: "Choose action",
  cast: "Choose action",
  target: "Choose this target",
  cost: "Select for cost",
  manual: "Put onto battlefield",
};

export function ZoneViewer({ source, ...props }: ZoneViewerProps) {
  const browserKey = zoneLocationKey(source, props.title);
  return <ZoneViewerContent key={browserKey} {...props} browserKey={browserKey} />;
}

function ZoneViewerContent({
  title,
  cards,
  mode,
  browserKey,
  totalCount,
  pending = false,
  onClose,
  onClickCard,
  clickableCardIds,
  selectedCardIds,
  clickLabel,
  selectedLabel,
  targetHostile,
}: Omit<ZoneViewerProps, "source"> & { browserKey: string }) {
  const theme = useTheme().gameTheme;
  const defaultRules = usePreferencesStore((state) => state.promptCardStyle === "rules");
  const saveState = useGameUIStore((state) => state.saveZoneBrowserState);
  const searchRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<ZoneBrowserCanvasHandle>(null);
  const [state, setState] = useState<CardBrowserState>(() => {
    const stored = useGameUIStore.getState().zoneBrowserStates[browserKey];
    return {
      ...(stored ?? INITIAL_CARD_BROWSER_STATE),
      inspection: { ...(stored?.inspection ?? {}) },
    };
  });
  const items = useMemo<CardBrowserItem[]>(() => {
    const legal = new Set(clickableCardIds);
    const selected = new Set(selectedCardIds);
    return cards.map((card) => ({
      id: card.id,
      card,
      selected: selected.has(card.id),
      legal: !!onClickCard && (mode === "manual" || legal.has(card.id) || selected.has(card.id)),
    }));
  }, [cards, clickableCardIds, mode, onClickCard, selectedCardIds]);
  const { searchable, loading, incomplete } = useBrowserSearchItems(items);
  const deferredQuery = useDeferredValue(state.query);
  const visible = useMemo(() => {
    const terms = deferredQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return searchable;
    return searchable.filter((item) => {
      const text = cardSearchText(item);
      return terms.every((term) => text.includes(term));
    });
  }, [deferredQuery, searchable]);
  const active =
    visible.find((item) => item.id === state.activeId) ??
    visible.find((item) => item.legal || item.selected) ??
    visible[0];
  const activeIndex = active ? visible.indexOf(active) : -1;
  const selectedCount = items.filter((item) => item.selected).length;
  const color =
    targetHostile === undefined
      ? theme.cardRing
      : targetHostile
        ? theme.arrow.hostileTarget
        : theme.arrow.friendlyTarget;

  useEffect(() => {
    saveState(browserKey, state);
  }, [browserKey, saveState, state]);

  const changeInspection = (item: CardBrowserItem, next: CardInspectionState) =>
    setState((current) => ({
      ...current,
      inspection: { ...current.inspection, [item.id]: next },
    }));
  const setActive = (id: string) =>
    setState((current) => (current.activeId === id ? current : { ...current, activeId: id }));
  const focusBy = (offset: number) => {
    if (!visible.length) return;
    const index =
      activeIndex < 0 ? 0 : Math.max(0, Math.min(visible.length - 1, activeIndex + offset));
    setActive(visible[index].id);
  };
  const activate = () => {
    if (!active || pending || (!active.legal && !active.selected)) return;
    onClickCard?.(active.id);
  };

  useKeybindings(
    {
      "card-search-focus": () => searchRef.current?.focus(),
      "toggle-card-view": () => {
        if (!active || isFacelessCard(active.card)) return false;
        canvasRef.current?.toggleActiveView();
      },
      "flip-card": () => {
        if (!active || isFacelessCard(active.card)) return false;
        canvasRef.current?.toggleActiveFace();
      },
    },
    scopeRef,
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
    const editable = event.target instanceof HTMLInputElement;
    if (event.key === "Escape" && state.query) {
      event.preventDefault();
      event.stopPropagation();
      setState((current) => ({ ...current, query: "" }));
      scopeRef.current?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Escape" && document.activeElement === searchRef.current) {
      event.preventDefault();
      event.stopPropagation();
      scopeRef.current?.focus({ preventScroll: true });
      return;
    }
    if (editable) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBy(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBy(1);
    } else if (event.key === "Home" && visible.length) {
      event.preventDefault();
      setActive(visible[0].id);
    } else if (event.key === "End" && visible.length) {
      event.preventDefault();
      setActive(visible[visible.length - 1].id);
    } else if ((event.key === "Enter" || event.key === " ") && event.target === scopeRef.current) {
      event.preventDefault();
      activate();
    }
  };

  const activeName = active
    ? isFacelessCard(active.card)
      ? "Face-down card"
      : active.card.identity.name
    : state.query
      ? "No matching card"
      : "No visible card";
  const activeStatus = active
    ? active.selected
      ? "Selected"
      : onClickCard
        ? active.legal
          ? "Available for this action"
          : "Unavailable for this action"
        : "Hover, scroll or use arrow keys to browse"
    : state.query
      ? "Clear the search to restore the ribbon"
      : "This zone has no visible cards";
  const actionText = active?.selected
    ? (selectedLabel ?? "Undo selection")
    : (clickLabel ?? ACTION_LABELS[mode]);
  const hiddenCount = totalCount != null ? Math.max(0, totalCount - cards.length) : 0;

  return (
    <FullscreenPrompt label={title} onClose={onClose} scopeRef={scopeRef} onKeyDown={onKeyDown}>
      <FullscreenPrompt.Header>
        <FullscreenPrompt.Title>
          <h2 className="truncate text-sm font-semibold sm:text-base">{title}</h2>
          <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
            {cards.length} visible card{cards.length === 1 ? "" : "s"}
            {hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
          </p>
        </FullscreenPrompt.Title>
        <div className="relative order-3 w-full sm:order-none sm:w-[min(38vw,28rem)]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            aria-label="Search cards by name, rules, type or mana"
            placeholder="Search this zone"
            value={state.query}
            onChange={(event) => setState((current) => ({ ...current, query: event.target.value }))}
            className="bg-background/80 pl-9 pr-9 focus-visible:ring-card-ring"
          />
          {state.query && (
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-0 top-0 h-9 w-9"
              aria-label="Clear search"
              onClick={() => {
                setState((current) => ({ ...current, query: "" }));
                searchRef.current?.focus();
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">
          {activeIndex >= 0 ? `${activeIndex + 1} / ${visible.length}` : `${visible.length}`}
        </span>
        <FullscreenPrompt.Close onClose={onClose} label="Close zone" />
        {(loading || incomplete) && (
          <p className="order-4 w-full px-2 text-[11px] text-muted-foreground" role="status">
            {loading
              ? "Loading card details for search…"
              : "Some card details are unavailable. Visible names and game rules remain searchable."}
          </p>
        )}
      </FullscreenPrompt.Header>

      <FullscreenPrompt.Stage>
        <ZoneBrowserCanvas
          actionsRef={canvasRef}
          items={visible}
          activeId={active?.id ?? null}
          inspection={state.inspection}
          defaultRules={defaultRules}
          pending={pending}
          ringColor={color}
          onActive={setActive}
          onChange={changeInspection}
        />
        {!visible.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {state.query ? "No cards match this search." : "No cards are visible in this zone."}
          </div>
        )}
      </FullscreenPrompt.Stage>

      <FullscreenPrompt.Footer>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-sm font-semibold">{activeName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {selectedCount > 0 ? `${selectedCount} selected · ` : ""}
            {activeStatus}
          </p>
        </div>
        <p className="hidden shrink-0 text-[11px] text-muted-foreground md:block">
          Scroll or drag · Arrow keys browse · R changes view · F flips
        </p>
        {onClickCard && (
          <FullscreenPrompt.Actions>
            <Button
              className="min-w-44"
              disabled={pending || !active || (!active.legal && !active.selected)}
              onClick={activate}
            >
              {pending && <LoaderCircle className={cn(animationsEnabled() && "animate-spin")} />}
              {pending ? "Waiting for response…" : actionText}
            </Button>
          </FullscreenPrompt.Actions>
        )}
      </FullscreenPrompt.Footer>
    </FullscreenPrompt>
  );
}

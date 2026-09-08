import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { cn } from "@/lib/utils";
import { DialogCardGrid } from "./DialogCardGrid";
import { DialogCardInspector } from "./DialogCardInspector";
import { DialogCardBrowserToolbar } from "./DialogCardBrowserToolbar";
import {
  filterBrowserItems,
  INITIAL_CARD_BROWSER_STATE,
  type CardBrowserItem,
  type CardBrowserState,
} from "./cardBrowser";
import { useBrowserSearchItems } from "./useBrowserSearchItems";
import { useKeybindings } from "@/hooks/useKeybindings";
import { useKeybindingsStore, resolveCombo } from "@/stores/useKeybindingsStore";
import { formatCombo } from "@/lib/keybindings";
import { useIsDesktop } from "@/hooks/useBreakpoints";

interface Props {
  items: CardBrowserItem[];
  modeLabel: string;
  pending?: boolean;
  intentColor?: string;
  onActivate?: (item: CardBrowserItem) => void;
  actionLabel?: (item: CardBrowserItem) => string;
  details?: (item: CardBrowserItem) => ReactNode;
  highlight?: (item: CardBrowserItem) => string;
  initialState?: CardBrowserState;
  onStateChange?: (state: CardBrowserState) => void;
}

export function DialogCardBrowser({
  items,
  modeLabel,
  pending = false,
  intentColor,
  onActivate,
  actionLabel,
  details,
  highlight,
  initialState,
  onStateChange,
}: Props) {
  const [state, setState] = useState<CardBrowserState>(initialState ?? INITIAL_CARD_BROWSER_STATE);
  const [mobileInspect, setMobileInspect] = useState(false);
  const desktop = useIsDesktop();
  const search = useRef<HTMLInputElement>(null);
  const scope = useRef<HTMLDivElement>(null);
  useKeybindings({ "card-search-focus": () => search.current?.focus() }, scope);
  const overrides = useKeybindingsStore((s) => s.overrides);
  const searchKey = resolveCombo("card-search-focus", overrides);
  const { searchable, loading, incomplete } = useBrowserSearchItems(items);
  const latestChange = useRef(onStateChange);
  useEffect(() => {
    latestChange.current = onStateChange;
  }, [onStateChange]);
  useEffect(() => {
    latestChange.current?.(state);
  }, [state]);
  const theme = useTheme().gameTheme;
  const defaultView = usePreferencesStore((s) => s.promptCardStyle);
  const query = useDeferredValue(state.query);
  const visible = useMemo(
    () =>
      filterBrowserItems(searchable, {
        ...INITIAL_CARD_BROWSER_STATE,
        query,
        type: state.type,
        color: state.color,
        sort: state.sort,
        onlyActions: state.onlyActions,
      }),
    [searchable, state.type, state.color, state.sort, state.onlyActions, query],
  );
  const types = useMemo(
    () => [...new Set(items.flatMap((item) => item.card.types))].sort(),
    [items],
  );
  const active = items.find((item) => item.id === state.activeId);
  const inspection = active
    ? (state.inspection[active.id] ?? {
        rules: defaultView === "rules",
        face: active.card.isTransformed ? (1 as const) : (0 as const),
        rotated: false,
      })
    : null;
  const changeFilter = (patch: Partial<CardBrowserState>) =>
    setState((current) => ({ ...current, ...patch, scrollTop: 0 }));
  const selectedCount = items.filter((item) => item.selected).length;
  const scroll = (scrollTop: number) =>
    setState((current) => (current.scrollTop === scrollTop ? current : { ...current, scrollTop }));
  const inspect = (id: string, open: boolean) => {
    setState((current) => (current.activeId === id ? current : { ...current, activeId: id }));
    if (open && !desktop) setMobileInspect(true);
  };
  return (
    <div
      ref={scope}
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
        if (event.key === "Escape" && mobileInspect && !desktop) {
          event.preventDefault();
          event.stopPropagation();
          setMobileInspect(false);
        } else if (event.key === "Escape" && state.query) {
          event.preventDefault();
          event.stopPropagation();
          changeFilter({ query: "" });
          search.current?.focus();
        }
      }}
    >
      <DialogCardBrowserToolbar
        search={search}
        state={state}
        types={types}
        modeLabel={modeLabel}
        visibleCount={visible.length}
        totalCount={items.length}
        selectedCount={selectedCount}
        hasActions={!!onActivate}
        loading={loading}
        incomplete={incomplete}
        onFilter={changeFilter}
        onSize={(size) => setState((current) => ({ ...current, size }))}
      />
      <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <div
          className={cn("min-h-0 flex-col", mobileInspect && active ? "hidden md:flex" : "flex")}
        >
          <DialogCardGrid
            items={visible}
            state={state}
            onInspect={inspect}
            onScroll={scroll}
            intentColor={intentColor ?? theme.cardRing}
          />
        </div>
        <div
          className={cn(
            "min-h-0 overflow-y-auto overscroll-contain",
            mobileInspect && active ? "block" : "hidden md:block",
          )}
        >
          {mobileInspect && active && (
            <Button
              variant="ghost"
              size="sm"
              className="mb-2 md:hidden"
              onClick={() => setMobileInspect(false)}
            >
              Back to cards
            </Button>
          )}
          {active && inspection ? (
            <DialogCardInspector
              card={active.card}
              state={inspection}
              onChange={(next) =>
                setState((current) => ({
                  ...current,
                  inspection: { ...current.inspection, [active.id]: next },
                }))
              }
              highlight={highlight?.(active)}
            >
              {details?.(active)}
              {onActivate && (
                <>
                  <Button
                    className="w-full whitespace-normal"
                    disabled={pending || (!active.legal && !active.selected)}
                    onClick={() => {
                      if (!pending && (active.legal || active.selected)) onActivate(active);
                    }}
                  >
                    {pending ? "Waiting for response…" : (actionLabel?.(active) ?? "Choose card")}
                  </Button>
                  {!active.legal && !active.selected && (
                    <p className="text-xs text-muted-foreground">
                      This card can be inspected, but is not available for this action.
                    </p>
                  )}
                </>
              )}
            </DialogCardInspector>
          ) : (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Focus, hover or tap a card to inspect it. Arrow keys browse
              {searchKey ? `; ${formatCombo(searchKey)} focuses search` : ""}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

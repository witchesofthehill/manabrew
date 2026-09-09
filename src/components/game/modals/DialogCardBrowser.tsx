import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTheme } from "@/hooks/useTheme";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { cn } from "@/lib/utils";
import { DialogCardGrid } from "./DialogCardGrid";
import { DialogCardPickerGrid } from "./DialogCardPickerGrid";
import { DialogCardBrowserToolbar } from "./DialogCardBrowserToolbar";
import { DialogCardBrowserActionTray } from "./DialogCardBrowserActionTray";
import { DialogCardBrowserInspectorPane } from "./DialogCardBrowserInspectorPane";
import {
  createCardBrowserState,
  filterBrowserItems,
  INITIAL_CARD_BROWSER_STATE,
  toggleCardBrowserRulesView,
  type CardBrowserItem,
  type CardBrowserState,
} from "./cardBrowser";
import { useBrowserSearchItems } from "./useBrowserSearchItems";
import { useKeybindings } from "@/hooks/useKeybindings";
import { useKeybindingsStore, resolveCombo } from "@/stores/useKeybindingsStore";
import { formatCombo } from "@/lib/keybindings";
import { useIsDesktop } from "@/hooks/useBreakpoints";
import { isFacelessCard } from "@/lib/gameCard";

interface Props {
  items: CardBrowserItem[];
  picker?: boolean;
  pending?: boolean;
  intentColor?: string;
  onActivate?: (item: CardBrowserItem) => void;
  actionLabel?: (item: CardBrowserItem) => string;
  defaultActionLabel?: string;
  details?: (item: CardBrowserItem) => ReactNode;
  highlight?: (item: CardBrowserItem) => string;
  initialState?: CardBrowserState;
  onStateChange?: (state: CardBrowserState) => void;
}

export function DialogCardBrowser({
  items,
  picker = false,
  pending = false,
  intentColor,
  onActivate,
  actionLabel,
  defaultActionLabel = "Choose card",
  details,
  highlight,
  initialState,
  onStateChange,
}: Props) {
  const defaultOnlyActions = picker && !!onActivate;
  const [state, setState] = useState<CardBrowserState>(() =>
    createCardBrowserState(initialState, picker, defaultOnlyActions),
  );
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const desktop = useIsDesktop();
  const search = useRef<HTMLInputElement>(null);
  const scope = useRef<HTMLDivElement>(null);
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
  const active = visible.find((item) => item.id === state.activeId);
  const inspection = active
    ? (state.inspection[active.id] ?? {
        rules: defaultView === "rules",
        face: active.card.isTransformed ? (1 as const) : (0 as const),
        rotated: false,
      })
    : null;
  const changeFilter = (patch: Partial<CardBrowserState>) => {
    setInspectionOpen(false);
    setState((current) => ({ ...current, ...patch, scrollTop: 0 }));
  };
  const selectedCount = items.filter((item) => item.selected).length;
  const scroll = (scrollTop: number) =>
    setState((current) => (current.scrollTop === scrollTop ? current : { ...current, scrollTop }));
  const inspect = (id: string, open: boolean) => {
    setState((current) => (current.activeId === id ? current : { ...current, activeId: id }));
    if (!picker && open && !desktop) setInspectionOpen(true);
  };
  const focusPickerCard = (id: string) => {
    const option = scope.current?.querySelector<HTMLElement>(`[data-card-key="${CSS.escape(id)}"]`);
    (option ?? scope.current)?.focus({ preventScroll: true });
  };
  const toggleView = (item: CardBrowserItem) => {
    if (!isFacelessCard(item.card)) {
      setState((current) => toggleCardBrowserRulesView(current, item, defaultView === "rules"));
    }
  };
  const changeInspection = (item: CardBrowserItem, next: CardBrowserState["inspection"][string]) =>
    setState((current) => ({
      ...current,
      inspection: { ...current.inspection, [item.id]: next },
    }));
  useKeybindings(
    {
      "card-search-focus": () => search.current?.focus(),
      ...(picker && active
        ? {
            "toggle-card-view": () => {
              focusPickerCard(active.id);
              toggleView(active);
            },
          }
        : {}),
    },
    scope,
  );
  return (
    <div
      ref={scope}
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col outline-none"
      onKeyDown={(event) => {
        if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
        if (event.key === "Escape" && inspectionOpen && !picker && !desktop) {
          event.preventDefault();
          event.stopPropagation();
          setInspectionOpen(false);
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
        picker={picker}
        visibleCount={visible.length}
        totalCount={items.length}
        selectedCount={selectedCount}
        hasActions={!!onActivate}
        loading={loading}
        incomplete={incomplete}
        onFilter={changeFilter}
        onSize={(size) => setState((current) => ({ ...current, size }))}
        defaultOnlyActions={defaultOnlyActions}
      />
      <div
        className={cn(
          "grid min-h-0 flex-1 gap-3 p-3",
          !picker && "md:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]",
        )}
      >
        {picker ? (
          <DialogCardPickerGrid
            items={visible}
            state={state}
            defaultRules={defaultView === "rules"}
            actionable={!!onActivate}
            onSelect={(id) => inspect(id, false)}
            onScroll={scroll}
            onChange={changeInspection}
          />
        ) : (
          <>
            <div
              className={cn(
                "min-h-0 flex-col",
                inspectionOpen && active ? "hidden md:flex" : "flex",
              )}
            >
              <DialogCardGrid
                items={visible}
                state={state}
                onInspect={inspect}
                onScroll={scroll}
                intentColor={intentColor ?? theme.cardRing}
              />
            </div>
            <DialogCardBrowserInspectorPane
              active={active}
              inspection={inspection}
              open={inspectionOpen}
              desktop={desktop}
              pending={pending}
              defaultActionLabel={defaultActionLabel}
              searchHint={searchKey ? `; ${formatCombo(searchKey)} focuses search` : ""}
              actionLabel={actionLabel}
              details={details}
              highlight={highlight}
              onClose={() => setInspectionOpen(false)}
              onInspectionChange={(next) => {
                if (active) changeInspection(active, next);
              }}
              onActivate={onActivate}
            />
          </>
        )}
      </div>
      {picker && onActivate && (
        <DialogCardBrowserActionTray
          active={active}
          selectedCount={selectedCount}
          pending={pending}
          defaultActionLabel={defaultActionLabel}
          actionLabel={actionLabel}
          onActivate={onActivate}
        />
      )}
    </div>
  );
}

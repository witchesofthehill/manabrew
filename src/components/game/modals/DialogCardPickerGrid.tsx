import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { isFacelessCard } from "@/lib/gameCard";
import {
  CARD_H,
  CARD_W,
  PROMPT_CARD_GAP,
  PROMPT_CARD_ROW_GAP,
} from "@/components/game/game.constants";
import { fitPromptCardDimensions, promptCardDisplayDimensions } from "@/components/game/game.utils";
import type { CardInspectionState } from "./cardInspection";
import {
  CARD_BROWSER_HORIZONTAL_PADDING,
  CARD_BROWSER_VERTICAL_PADDING,
  type CardBrowserItem,
  type CardBrowserState,
} from "./cardBrowser";
import { DialogCardPickerCanvas } from "./DialogCardPickerCanvas";
interface DialogCardPickerGridProps {
  items: CardBrowserItem[];
  state: CardBrowserState;
  defaultRules: boolean;
  actionable: boolean;
  pending: boolean;
  onSelect: (id: string) => void;
  onActivate?: (item: CardBrowserItem) => void;
  onHover: (id: string | null) => void;
  onScroll: (top: number) => void;
  onChange: (item: CardBrowserItem, state: CardInspectionState) => void;
}

export function DialogCardPickerGrid({
  items,
  state,
  defaultRules,
  actionable,
  pending,
  onSelect,
  onActivate,
  onHover,
  onScroll,
  onChange,
}: DialogCardPickerGridProps) {
  const host = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(() => ({
    width: 600,
    height: 500,
    screenHeight: typeof window === "undefined" ? 800 : window.innerHeight,
  }));
  const [initialScrollTop] = useState(state.scrollTop);
  const isAvailable = (item: CardBrowserItem) => !actionable || item.legal || item.selected;

  useEffect(() => {
    const node = host.current!;
    node.scrollTop = initialScrollTop;
    const measure = () => {
      if (node.clientWidth > 0 && node.clientHeight > 0) {
        setViewport({
          width: node.clientWidth,
          height: node.clientHeight,
          screenHeight: window.innerHeight,
        });
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [initialScrollTop]);

  const gridWidth = Math.max(0, viewport.width - CARD_BROWSER_HORIZONTAL_PADDING * 2);
  const { portraitCardWidth, cardSizes, cellWidth, cellHeight } = useMemo(() => {
    const preferredWidth = fitPromptCardDimensions(gridWidth, viewport.screenHeight).width;
    const states = items.map((item) => {
      const inspection = state.inspection[item.id] ?? {
        rules: defaultRules,
        face: item.card.isTransformed ? (1 as const) : (0 as const),
        rotated: false,
      };
      return { item, inspection };
    });
    const maxWidthRatio = Math.max(
      1,
      ...states.map(
        ({ item, inspection }) =>
          promptCardDisplayDimensions(item.card, CARD_W, inspection.face, inspection.rotated)
            .width / CARD_W,
      ),
    );
    const width = Math.min(preferredWidth, gridWidth / maxWidthRatio);
    const sizes = new Map(
      states.map(({ item, inspection }) => [
        item.id,
        promptCardDisplayDimensions(item.card, width, inspection.face, inspection.rotated),
      ]),
    );
    const displaySizes = [...sizes.values()];
    return {
      portraitCardWidth: width,
      cardSizes: sizes,
      cellWidth: displaySizes.length ? Math.max(...displaySizes.map((size) => size.width)) : width,
      cellHeight: displaySizes.length
        ? Math.max(...displaySizes.map((size) => size.height))
        : (width * CARD_H) / CARD_W,
    };
  }, [defaultRules, gridWidth, items, state.inspection, viewport.screenHeight]);
  const columns = Math.max(
    1,
    Math.floor((gridWidth + PROMPT_CARD_GAP) / (cellWidth + PROMPT_CARD_GAP)),
  );
  const rowHeight = cellHeight + PROMPT_CARD_ROW_GAP;
  const rows = Math.ceil(items.length / columns);
  const contentHeight = Math.max(
    viewport.height,
    rows * rowHeight + CARD_BROWSER_VERTICAL_PADDING * 2,
  );
  const top = Math.min(state.scrollTop, Math.max(0, contentHeight - viewport.height));
  const start =
    Math.max(0, Math.floor(Math.max(0, top - CARD_BROWSER_VERTICAL_PADDING) / rowHeight) - 1) *
    columns;
  const end = Math.min(
    items.length,
    Math.ceil((top + viewport.height - CARD_BROWSER_VERTICAL_PADDING) / rowHeight + 1) * columns,
  );
  const visible = useMemo(() => items.slice(start, end), [items, start, end]);
  const tabStopId =
    (state.activeId && visible.some((item) => item.id === state.activeId && isAvailable(item))
      ? state.activeId
      : visible.find(isAvailable)?.id) ?? visible[0]?.id;

  useEffect(() => {
    if (host.current && host.current.scrollTop !== top) host.current.scrollTop = top;
  }, [top]);

  const focus = (index: number, direction: 1 | -1) => {
    let next = index;
    while (next >= 0 && next < items.length && !isAvailable(items[next])) {
      next += direction;
    }
    const item = items[next];
    if (!item) return;
    onSelect(item.id);
    const node = host.current!;
    const rowTop = CARD_BROWSER_VERTICAL_PADDING + Math.floor(next / columns) * rowHeight;
    const nextTop =
      rowTop < node.scrollTop
        ? rowTop
        : rowTop + rowHeight > node.scrollTop + node.clientHeight
          ? rowTop + rowHeight - node.clientHeight
          : node.scrollTop;
    node.scrollTop = nextTop;
    onScroll(nextTop);
    requestAnimationFrame(() =>
      node.querySelector<HTMLButtonElement>(`[data-card-key="${CSS.escape(item.id)}"]`)?.focus(),
    );
  };

  return (
    <div
      ref={host}
      role="listbox"
      aria-label="Cards in this view"
      className="min-h-56 flex-1 overflow-auto overscroll-contain"
      onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const index = Math.max(
          0,
          items.findIndex((item) => item.id === state.activeId),
        );
        const next =
          event.key === "ArrowRight"
            ? index + 1
            : event.key === "ArrowLeft"
              ? index - 1
              : event.key === "ArrowDown"
                ? index + columns
                : event.key === "ArrowUp"
                  ? index - columns
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : null;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        const direction =
          event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
        focus(Math.max(0, Math.min(items.length - 1, next)), direction);
      }}
    >
      <div className="relative" style={{ height: contentHeight }}>
        <DialogCardPickerCanvas
          items={visible}
          startIndex={start}
          state={state}
          defaultRules={defaultRules}
          columns={columns}
          cellWidth={cellWidth}
          cellHeight={cellHeight}
          rowHeight={rowHeight}
          scrollTop={top}
          cardSize={portraitCardWidth}
          width={viewport.width}
          height={viewport.height}
          actionable={actionable}
          pending={pending}
          onSelect={onSelect}
          onActivate={onActivate}
          onHover={onHover}
          onChange={onChange}
        />
        {visible.map((item, offset) => {
          const index = start + offset;
          const rowTop = CARD_BROWSER_VERTICAL_PADDING + Math.floor(index / columns) * rowHeight;
          const cellLeft =
            CARD_BROWSER_HORIZONTAL_PADDING + (index % columns) * (cellWidth + PROMPT_CARD_GAP);
          const cardSize = cardSizes.get(item.id) ?? {
            width: portraitCardWidth,
            height: (portraitCardWidth * CARD_H) / CARD_W,
          };
          const cardLeft = cellLeft + (cellWidth - cardSize.width) / 2;
          const cardTop = rowTop + (cellHeight - cardSize.height) / 2;
          const name = isFacelessCard(item.card) ? "Face-down card" : item.card.identity.name;
          const unavailable = pending || !isAvailable(item);
          return (
            <div key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={item.selected}
                aria-posinset={index + 1}
                aria-setsize={items.length}
                aria-label={`${name}${item.selected ? ", selected" : item.legal ? ", action available" : ""}`}
                aria-disabled={unavailable}
                data-card-key={item.id}
                tabIndex={item.id === tabStopId ? 0 : -1}
                className="pointer-events-none absolute z-10 opacity-0"
                style={{
                  left: cardLeft,
                  top: cardTop,
                  width: cardSize.width,
                  height: cardSize.height,
                }}
                onFocus={() => {
                  if (!unavailable) onSelect(item.id);
                }}
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === " ") && !unavailable && actionable) {
                    event.preventDefault();
                    onSelect(item.id);
                    onActivate?.(item);
                  }
                }}
              />
              {item.selected && (
                <span
                  className="pointer-events-none absolute z-10 rounded-full border bg-card p-1 text-card-ring"
                  style={{ left: cardLeft + 8, top: cardTop + 8 }}
                >
                  <Check className="h-3 w-3" />
                </span>
              )}
            </div>
          );
        })}
        {!items.length && (
          <p
            className="absolute inset-x-0 top-0 p-8 text-center text-sm text-muted-foreground"
            role="status"
          >
            No matching cards. Clear or change the filters.
          </p>
        )}
      </div>
    </div>
  );
}

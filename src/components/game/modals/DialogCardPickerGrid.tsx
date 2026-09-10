import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { isFacelessCard } from "@/lib/gameCard";
import { cn } from "@/lib/utils";
import { GAME_CARD_SIZES } from "@/components/game/game.constants";
import type { CardInspectionState } from "./cardInspection";
import {
  CARD_BROWSER_GAP,
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
  onSelect: (id: string) => void;
  onHover: (id: string) => void;
  onScroll: (top: number) => void;
  onChange: (item: CardBrowserItem, state: CardInspectionState) => void;
}

const LABEL_HEIGHT = 28;

export function DialogCardPickerGrid({
  items,
  state,
  defaultRules,
  actionable,
  onSelect,
  onHover,
  onScroll,
  onChange,
}: DialogCardPickerGridProps) {
  const host = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 600, height: 500 });
  const [initialScrollTop] = useState(state.scrollTop);

  useEffect(() => {
    const node = host.current!;
    node.scrollTop = initialScrollTop;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth > 0 && node.clientHeight > 0) {
        setViewport({ width: node.clientWidth, height: node.clientHeight });
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [initialScrollTop]);

  const columns = Math.max(
    1,
    Math.floor(
      (viewport.width + CARD_BROWSER_GAP) / (GAME_CARD_SIZES.preview.width + CARD_BROWSER_GAP),
    ),
  );
  const cellWidth = (viewport.width - CARD_BROWSER_GAP * (columns - 1)) / columns;
  const cardHeight = GAME_CARD_SIZES.preview.height;
  const rowHeight = cardHeight + LABEL_HEIGHT;
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
  const autofocusId =
    (state.activeId && visible.some((item) => item.id === state.activeId)
      ? state.activeId
      : visible.find((item) => item.legal || item.selected)?.id) ?? visible[0]?.id;

  useEffect(() => {
    if (host.current && host.current.scrollTop !== top) host.current.scrollTop = top;
  }, [top]);

  const focus = (index: number) => {
    const item = items[index];
    if (!item) return;
    onSelect(item.id);
    const node = host.current!;
    const rowTop = CARD_BROWSER_VERTICAL_PADDING + Math.floor(index / columns) * rowHeight;
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
        focus(Math.max(0, Math.min(items.length - 1, next)));
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
          rowHeight={rowHeight}
          scrollTop={top}
          cardSize={GAME_CARD_SIZES.preview.width}
          width={viewport.width}
          height={viewport.height}
          actionable={actionable}
          onSelect={onSelect}
          onHover={onHover}
          onChange={onChange}
        />
        {visible.map((item, offset) => {
          const index = start + offset;
          const rowTop = CARD_BROWSER_VERTICAL_PADDING + Math.floor(index / columns) * rowHeight;
          const cellLeft = (index % columns) * (cellWidth + CARD_BROWSER_GAP);
          const cardLeft = cellLeft + (cellWidth - GAME_CARD_SIZES.preview.width) / 2;
          const name = isFacelessCard(item.card) ? "Face-down card" : item.card.identity.name;
          return (
            <div key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={state.activeId === item.id}
                aria-posinset={index + 1}
                aria-setsize={items.length}
                aria-label={`${name}${item.selected ? ", selected" : item.legal ? ", action available" : ""}`}
                data-card-key={item.id}
                tabIndex={item.id === autofocusId ? 0 : -1}
                data-autofocus={item.id === autofocusId ? true : undefined}
                className="pointer-events-none absolute z-10 opacity-0"
                style={{
                  left: cardLeft,
                  top: rowTop,
                  width: GAME_CARD_SIZES.preview.width,
                  height: cardHeight,
                }}
                onFocus={() => onSelect(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(item.id);
                  }
                }}
              />
              {item.selected && (
                <span
                  className="pointer-events-none absolute z-10 rounded-full border bg-card p-1 text-card-ring"
                  style={{ left: cardLeft + 8, top: rowTop + 8 }}
                >
                  <Check className="h-3 w-3" />
                </span>
              )}
              <span
                className={cn(
                  "pointer-events-none absolute z-10 line-clamp-1 text-center text-xs font-medium transition-colors",
                  state.activeId === item.id || item.selected
                    ? "text-card-ring"
                    : "text-foreground",
                )}
                style={{ left: cellLeft, top: rowTop + cardHeight + 4, width: cellWidth }}
              >
                {name}
              </span>
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

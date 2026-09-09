import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Card } from "@/components/game/Card";
import { useTheme } from "@/hooks/useTheme";
import { isFacelessCard } from "@/lib/gameCard";
import { cn } from "@/lib/utils";
import type { CardBrowserItem, CardBrowserState } from "./cardBrowser";

interface Props {
  items: CardBrowserItem[];
  state: CardBrowserState;
  onInspect: (id: string, touch: boolean) => void;
  onScroll: (top: number) => void;
  intentColor: string;
}
const GAP = 12;

export function DialogCardGrid({ items, state, onInspect, onScroll, intentColor }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 600, height: 500 });
  const [initialScrollTop] = useState(state.scrollTop);
  const theme = useTheme().gameTheme;
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
  const columns = Math.max(1, Math.floor((viewport.width + GAP) / (state.size + GAP)));
  const cellWidth = (viewport.width - GAP * (columns - 1)) / columns;
  const rowHeight = (state.size * 100) / 72 + 48;
  const rows = Math.ceil(items.length / columns);
  const top = Math.min(state.scrollTop, Math.max(0, rows * rowHeight - viewport.height));
  const start = Math.max(0, Math.floor(top / rowHeight) - 1) * columns;
  const end = Math.min(items.length, Math.ceil((top + viewport.height) / rowHeight + 1) * columns);
  useEffect(() => {
    if (host.current && host.current.scrollTop !== top) host.current.scrollTop = top;
  }, [top]);
  const focus = (index: number) => {
    const item = items[index];
    if (!item) return;
    onInspect(item.id, false);
    const node = host.current!;
    const rowTop = Math.floor(index / columns) * rowHeight;
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
      className="min-h-56 flex-1 overflow-auto overscroll-contain pr-2"
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
      <div className="relative" style={{ height: rows * rowHeight }}>
        {items.slice(start, end).map((item, offset) => {
          const index = start + offset;
          const active = state.activeId === item.id;
          const name = isFacelessCard(item.card) ? "Face-down card" : item.card.identity.name;
          const color =
            item.selected || active ? theme.cardRing : item.legal ? intentColor : undefined;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={active}
              aria-posinset={index + 1}
              aria-setsize={items.length}
              aria-label={`${name}${item.selected ? ", selected" : item.legal ? ", action available" : ", inspect"}`}
              data-card-key={item.id}
              tabIndex={active || (!state.activeId && index === 0) ? 0 : -1}
              className={cn(
                "absolute flex flex-col items-center rounded-lg border p-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-card-ring hover:border-card-ring",
                active ? "bg-muted/60" : "border-transparent",
              )}
              style={{
                left: (index % columns) * (cellWidth + GAP),
                top: Math.floor(index / columns) * rowHeight,
                width: cellWidth,
                height: rowHeight - GAP,
                borderColor: color,
              }}
              onFocus={() => onInspect(item.id, false)}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch") onInspect(item.id, false);
              }}
              onClick={() => onInspect(item.id, true)}
            >
              <div className="flex w-full flex-1 items-center" style={{ maxWidth: state.size }}>
                <Card
                  card={item.card}
                  bare
                  showBackFace={
                    state.inspection[item.id]?.face === 1 ||
                    (!state.inspection[item.id] && item.card.isTransformed)
                  }
                  style={{ width: "100%" }}
                  className="border-0 shadow-md"
                  resolution="normal"
                />
              </div>
              <span className="mt-1 line-clamp-1 w-full text-center text-xs font-medium">
                {name}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                {item.selected && <Check className="h-3 w-3 text-card-ring" />}
                {item.position ??
                  (item.selected ? "Selected" : item.legal ? "Action available" : "Inspect")}
              </span>
            </button>
          );
        })}
      </div>
      {!items.length && (
        <p className="p-8 text-center text-sm text-muted-foreground" role="status">
          No matching cards. Clear or change the filters.
        </p>
      )}
    </div>
  );
}

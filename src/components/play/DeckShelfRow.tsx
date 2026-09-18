import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DeckShelfRowProps {
  label: string;
  children: ReactNode;
}

export const DECK_SHELF_CARD_CLASS = "w-[70vw] max-w-64 shrink-0 snap-start sm:w-72 sm:max-w-none";

export function DeckShelfRow({ label, children }: DeckShelfRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    function update() {
      if (!row) return;
      setCanScrollLeft(row.scrollLeft > 1);
      setCanScrollRight(row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
    }
    update();
    row.addEventListener("scroll", update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(row);
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(row, { childList: true });
    return () => {
      row.removeEventListener("scroll", update);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  function scrollByPage(direction: -1 | 1) {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({ left: direction * row.clientWidth * 0.85, behavior: "smooth" });
  }

  return (
    <div className="relative">
      <div
        ref={rowRef}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto no-scrollbar px-1 pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:rounded-lg"
      >
        {children}
      </div>
      {canScrollLeft && (
        <Button
          size="icon"
          variant="secondary"
          aria-label={`Scroll ${label} left`}
          onClick={() => scrollByPage(-1)}
          className="absolute -left-2 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 rounded-full shadow-lg sm:inline-flex"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}
      {canScrollRight && (
        <Button
          size="icon"
          variant="secondary"
          aria-label={`Scroll ${label} right`}
          onClick={() => scrollByPage(1)}
          className="absolute -right-2 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 rounded-full shadow-lg sm:inline-flex"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

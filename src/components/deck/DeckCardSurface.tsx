import type { ReactNode } from "react";
import { DECK_NAME_SHADOW_CLASS } from "@/components/deck/deckDisplay.utils";
import { cn } from "@/lib/utils";

interface DeckCardSurfaceProps {
  title: string;
  subtitle?: string;
  ariaLabel: string;
  cover: ReactNode;
  footer: ReactNode;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  titleClassName?: string;
  onOpen: () => void;
}

export function DeckCardSurface({
  title,
  subtitle,
  ariaLabel,
  cover,
  footer,
  topLeft,
  topRight,
  titleClassName,
  onOpen,
}: DeckCardSurfaceProps) {
  return (
    <div className="group relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted transition-all hover:border-primary hover:ring-2 hover:ring-primary">
      <button
        type="button"
        className="absolute inset-0 w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
        aria-label={ariaLabel}
      >
        {cover}
        <span className="absolute inset-0 bg-gradient-to-t from-overlay/80 via-overlay/20 to-overlay/10" />
        <span className="absolute bottom-0 left-0 right-0 z-10 block px-2 pb-2 pt-8">
          <span
            className={cn(
              "block truncate text-sm font-semibold leading-tight text-text-on-tinted",
              DECK_NAME_SHADOW_CLASS,
              titleClassName,
            )}
          >
            {title}
          </span>
          {subtitle && (
            <span
              className={cn(
                "block truncate text-[11px] text-text-on-tinted/85",
                DECK_NAME_SHADOW_CLASS,
              )}
            >
              {subtitle}
            </span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-1">{footer}</span>
        </span>
      </button>
      {topLeft && (
        <div className="absolute left-1.5 top-1.5 z-20 max-w-[calc(100%-4.5rem)]">{topLeft}</div>
      )}
      {topRight && <div className="absolute right-1.5 top-1.5 z-20">{topRight}</div>}
    </div>
  );
}

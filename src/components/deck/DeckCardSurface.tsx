import type { ReactNode } from "react";
import { DECK_NAME_SHADOW_CLASS } from "@/components/deck/deckDisplay.utils";
import { cn } from "@/lib/utils";

interface DeckCardSurfaceProps {
  title: string;
  subtitle?: string;
  description?: string;
  ariaLabel: string;
  cover: ReactNode;
  footer: ReactNode;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  titleClassName?: string;
  onOpen: () => void;
  variant?: "card" | "hero" | "list";
}

export function DeckCardSurface({
  title,
  subtitle,
  description,
  ariaLabel,
  cover,
  footer,
  topLeft,
  topRight,
  titleClassName,
  onOpen,
  variant = "card",
}: DeckCardSurfaceProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted transition-all hover:border-primary hover:ring-2 hover:ring-primary",
        variant === "list"
          ? "h-32 sm:h-36"
          : variant === "hero"
            ? "aspect-[4/3] sm:aspect-[16/7]"
            : "aspect-[4/3]",
      )}
    >
      <button
        type="button"
        className="absolute inset-0 w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
        aria-label={ariaLabel}
      >
        {cover}
        <span
          className={cn(
            "absolute inset-0",
            variant === "list"
              ? "bg-gradient-to-r from-overlay/30 via-background/95 to-background"
              : "bg-gradient-to-t from-overlay/80 via-overlay/20 to-overlay/10",
          )}
        />
        <span
          className={cn(
            "absolute bottom-0 left-0 right-0 z-10 block px-2 pb-2 pt-8",
            variant === "list" &&
              "inset-y-0 left-32 flex flex-col justify-center px-3 pb-0 pr-14 pt-0 sm:left-48 sm:px-4",
          )}
        >
          <span
            className={cn(
              "block truncate text-sm font-semibold leading-tight text-text-on-tinted",
              DECK_NAME_SHADOW_CLASS,
              variant === "list" && "text-base text-foreground shadow-none",
              variant === "hero" && "text-lg sm:text-2xl",
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
                variant === "list" && "mt-1 text-xs text-muted-foreground shadow-none",
              )}
            >
              {subtitle}
            </span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-1">{footer}</span>
          {variant === "list" && description && (
            <span className="mt-2 line-clamp-1 text-xs text-muted-foreground">{description}</span>
          )}
        </span>
      </button>
      {topLeft && (
        <div className="absolute left-1.5 top-1.5 z-20 max-w-[calc(100%-4.5rem)]">{topLeft}</div>
      )}
      {topRight && <div className="absolute right-1.5 top-1.5 z-20">{topRight}</div>}
    </div>
  );
}

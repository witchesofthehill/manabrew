import type { CSSProperties, ReactNode } from "react";
import { DECK_NAME_SHADOW_CLASS } from "@/components/deck/deckDisplay.utils";
import { cn } from "@/lib/utils";

interface DeckCardSurfaceProps {
  title: string;
  subtitle?: string;
  description?: string;
  supportingText?: string;
  ariaLabel: string;
  cover: ReactNode;
  footer: ReactNode;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  titleClassName?: string;
  onOpen: () => void;
  onSubtitleClick?: () => void;
  subtitleAriaLabel?: string;
  variant?: "card" | "hero" | "list" | "stage";
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  loading?: boolean;
  pressed?: boolean;
  titleAttribute?: string;
  onDoubleClick?: () => void;
}

export function DeckCardSurface({
  title,
  subtitle,
  description,
  supportingText,
  ariaLabel,
  cover,
  footer,
  topLeft,
  topRight,
  titleClassName,
  onOpen,
  onSubtitleClick,
  subtitleAriaLabel,
  variant = "card",
  className,
  style,
  disabled = false,
  loading = false,
  pressed,
  titleAttribute,
  onDoubleClick,
}: DeckCardSurfaceProps) {
  return (
    <div
      className={cn(
        "group relative flex flex-col justify-end overflow-hidden rounded-lg border bg-muted transition-all hover:border-primary hover:ring-2 hover:ring-primary",
        variant === "list"
          ? "min-h-40"
          : variant === "stage"
            ? "aspect-[4/3] md:aspect-auto md:min-h-full"
            : variant === "hero"
              ? "aspect-[4/3] sm:aspect-[16/7]"
              : "aspect-[4/3]",
        disabled && "opacity-60",
        className,
      )}
      style={style}
    >
      <button
        type="button"
        className="absolute inset-0 w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset touch:min-h-11 touch:min-w-11"
        onClick={onOpen}
        onDoubleClick={onDoubleClick}
        aria-label={ariaLabel}
        aria-pressed={pressed}
        aria-busy={loading}
        disabled={disabled}
        title={titleAttribute}
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
      </button>
      {topLeft && (
        <div className="relative z-20 mb-auto ml-1.5 mt-1.5 min-h-11 max-w-[calc(100%-4.5rem)]">
          {topLeft}
        </div>
      )}
      <span
        className={cn(
          "pointer-events-none relative z-10 block px-2 pb-2 pt-14",
          topLeft && "pt-3",
          variant === "list" &&
            "ml-24 flex flex-col justify-center px-3 pb-3 pr-14 pt-14 sm:ml-48 sm:px-4",
        )}
      >
        <span
          className={cn(
            "block truncate text-ui-label font-semibold text-text-on-tinted",
            DECK_NAME_SHADOW_CLASS,
            variant === "list" && "text-foreground shadow-none",
            variant === "hero" && "text-lg sm:text-2xl",
            titleClassName,
          )}
          title={title}
        >
          {title}
        </span>
        {subtitle && onSubtitleClick ? (
          <button
            type="button"
            className={cn(
              "pointer-events-auto relative block max-w-full truncate text-left text-ui-meta text-text-on-tinted/85 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11 touch:min-w-11",
              DECK_NAME_SHADOW_CLASS,
              variant === "list" && "mt-1 text-muted-foreground shadow-none",
            )}
            aria-label={subtitleAriaLabel}
            onClick={onSubtitleClick}
          >
            {subtitle}
          </button>
        ) : subtitle ? (
          <span
            className={cn(
              "block truncate text-ui-meta text-text-on-tinted/85",
              DECK_NAME_SHADOW_CLASS,
              variant === "list" && "mt-1 text-muted-foreground shadow-none",
            )}
          >
            {subtitle}
          </span>
        ) : null}
        {supportingText && (
          <span
            className={cn(
              "mt-1 block truncate text-ui-meta text-text-on-tinted/80",
              DECK_NAME_SHADOW_CLASS,
              variant === "list" && "text-muted-foreground shadow-none",
            )}
            title={supportingText}
          >
            {supportingText}
          </span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-1">{footer}</span>
        {variant === "list" && description && (
          <span
            className="mt-2 line-clamp-1 text-ui-body text-muted-foreground"
            title={description}
          >
            {description}
          </span>
        )}
      </span>
      {topRight && <div className="absolute right-1.5 top-1.5 z-20">{topRight}</div>}
    </div>
  );
}

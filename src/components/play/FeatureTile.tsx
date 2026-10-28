import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
interface TileAccent {
  chip: string;
  hoverBorder: string;
  watermark: string;
}
const TILE_ACCENTS: Record<string, TileAccent> = {
  primary: {
    chip: "border-primary/40 bg-primary/15 text-primary",
    hoverBorder: "hover:border-primary/70",
    watermark: "text-primary opacity-[0.07]",
  },
  secondary: {
    chip: "border-secondary/40 bg-secondary/15 text-secondary",
    hoverBorder: "hover:border-secondary",
    watermark: "text-secondary opacity-[0.07]",
  },
  blue: {
    chip: "border-format-badge-blue/40 bg-format-badge-blue/15 text-format-badge-blue",
    hoverBorder: "hover:border-format-badge-blue/60",
    watermark: "text-foreground opacity-[0.05]",
  },
  rose: {
    chip: "border-format-badge-rose/40 bg-format-badge-rose/15 text-format-badge-rose",
    hoverBorder: "hover:border-format-badge-rose/60",
    watermark: "text-foreground opacity-[0.05]",
  },
  amber: {
    chip: "border-format-badge-amber/40 bg-format-badge-amber/15 text-format-badge-amber",
    hoverBorder: "hover:border-format-badge-amber/60",
    watermark: "text-foreground opacity-[0.05]",
  },
  community: {
    chip: "border-community-accent/45 bg-community-accent/15 text-community-accent",
    hoverBorder: "hover:border-community-accent/70",
    watermark: "text-community-accent opacity-[0.09]",
  },
};
const TILE_SIZES = {
  lg: {
    tile: "min-h-44 gap-6 p-5 text-left shadow-xl hover:shadow-2xl motion-safe:transition-[border-color,box-shadow] sm:min-h-52 sm:p-7 lg:min-h-60",
    column: "gap-6",
    chip: "h-12 w-12",
    chipIcon: "h-5 w-5",
    watermark: "-bottom-8 -right-5 h-36 w-36 sm:h-44 sm:w-44",
    label: `font-serif text-2xl font-semibold sm:text-3xl`,
    desc: "mt-1 text-ui-body",
  },
  sm: {
    tile: "min-h-32 gap-3 p-4 shadow-md motion-safe:transition-colors sm:min-h-36 sm:p-5",
    column: "gap-3",
    chip: "h-9 w-9",
    chipIcon: "h-4 w-4",
    watermark: "-bottom-4 -right-4 h-24 w-24",
    label: `text-ui-label font-medium`,
    desc: "mt-0.5 text-ui-body leading-snug",
  },
} as const;
interface FeatureTileProps {
  to: string;
  label: string;
  desc: string;
  icon: ComponentType<{
    className?: string;
  }>;
  image?: string;
  imageClassName?: string;
  tone: string;
  size?: keyof typeof TILE_SIZES;
  footer?: ReactNode;
  className?: string;
  compact?: boolean;
}
export function FeatureTile({
  to,
  label,
  desc,
  icon: Icon,
  image,
  imageClassName,
  tone,
  size = "sm",
  footer,
  className,
  compact = false,
}: FeatureTileProps) {
  const accent = TILE_ACCENTS[tone] ?? TILE_ACCENTS.primary;
  const sizing = TILE_SIZES[size];
  return (
    <Link
      to={to}
      className={cn(
        "group relative flex min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card/85 backdrop-blur-md motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        sizing.tile,
        compact && "min-h-28 items-center gap-4 p-4 sm:min-h-28 sm:p-4 lg:min-h-28",
        accent.hoverBorder,
        className,
      )}
    >
      {!image && (
        <Icon
          aria-hidden="true"
          className={cn(
            "absolute rotate-12",
            sizing.watermark,
            compact && "-bottom-6 -right-4 h-28 w-28 sm:h-28 sm:w-28",
            accent.watermark,
          )}
        />
      )}
      <span
        className={cn(
          "flex min-w-0 flex-1 flex-col justify-between",
          sizing.column,
          compact && "flex-row items-center gap-4",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full border",
            sizing.chip,
            compact && "h-11 w-11",
            accent.chip,
          )}
        >
          <Icon className={sizing.chipIcon} />
        </span>
        <span className="relative">
          <span className={cn("block min-w-0", sizing.label, compact && "text-xl sm:text-xl")}>
            {label}
          </span>
          <span className={cn("block text-muted-foreground", sizing.desc)}>{desc}</span>
          {footer}
        </span>
      </span>
      {image && (
        <span
          className={cn(
            "-mb-5 flex h-0 shrink-0 flex-col justify-end self-end sm:-mb-7",
            compact && "mb-0 self-center justify-center sm:mb-0",
          )}
        >
          <img
            src={image}
            alt=""
            aria-hidden="true"
            draggable={false}
            className={cn(
              "pointer-events-none max-w-none origin-bottom object-contain will-change-transform motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:group-hover:scale-105 motion-safe:group-active:scale-95 motion-safe:group-active:duration-150",
              compact ? "h-24 w-24" : imageClassName,
            )}
          />
        </span>
      )}
    </Link>
  );
}

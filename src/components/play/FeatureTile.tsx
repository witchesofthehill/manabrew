import type { ComponentType, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const TILE_ACCENTS: Record<string, { chip: string; hoverBorder: string; watermark: string }> = {
  primary: {
    chip: "border-primary/40 bg-primary/15 text-primary",
    hoverBorder: "hover:border-primary/70",
    watermark: "text-primary opacity-[0.07]",
  },
  sky: {
    chip: "border-format-badge-sky/40 bg-format-badge-sky/15 text-format-badge-sky",
    hoverBorder: "hover:border-format-badge-sky/60",
    watermark: "text-format-badge-sky opacity-[0.07]",
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
};

const TILE_SIZES = {
  lg: {
    tile: "min-h-44 gap-6 p-5 text-left shadow-xl hover:shadow-2xl motion-safe:transition-[transform,border-color,box-shadow] motion-safe:hover:-translate-y-0.5 sm:min-h-52 sm:p-7 lg:min-h-60",
    chip: "h-12 w-12",
    chipIcon: "h-5 w-5",
    watermark: "-bottom-8 -right-5 h-36 w-36 sm:h-44 sm:w-44",
    label: "gap-3 font-serif text-2xl font-light sm:text-3xl",
    arrow: "h-5 w-5 motion-safe:group-hover:translate-x-1",
    desc: "mt-1 text-sm",
  },
  sm: {
    tile: "min-h-32 gap-3 p-4 shadow-md motion-safe:transition-colors sm:min-h-36 sm:p-5",
    chip: "h-9 w-9",
    chipIcon: "h-4 w-4",
    watermark: "-bottom-4 -right-4 h-24 w-24",
    label: "gap-2 text-sm font-medium",
    arrow:
      "h-4 w-4 text-muted-foreground motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:text-foreground",
    desc: "mt-0.5 text-xs leading-snug",
  },
} as const;

interface FeatureTileProps {
  to: string;
  label: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
  size?: keyof typeof TILE_SIZES;
  footer?: ReactNode;
  className?: string;
}

export function FeatureTile({
  to,
  label,
  desc,
  icon: Icon,
  tone,
  size = "sm",
  footer,
  className,
}: FeatureTileProps) {
  const accent = TILE_ACCENTS[tone] ?? TILE_ACCENTS.primary;
  const sizing = TILE_SIZES[size];
  return (
    <Link
      to={to}
      className={cn(
        "group relative flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-border/70 bg-card/85 backdrop-blur-md motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        sizing.tile,
        accent.hoverBorder,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("absolute rotate-12", sizing.watermark, accent.watermark)}
      />
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border",
          sizing.chip,
          accent.chip,
        )}
      >
        <Icon className={sizing.chipIcon} />
      </span>
      <span className="relative">
        <span className={cn("flex min-w-0 items-center justify-between", sizing.label)}>
          {label}
          <ArrowRight className={cn("shrink-0 motion-safe:transition-transform", sizing.arrow)} />
        </span>
        <span className={cn("block text-muted-foreground", sizing.desc)}>{desc}</span>
        {footer}
      </span>
    </Link>
  );
}

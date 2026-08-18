import { getFormat } from "@/lib/formats";
import { cn } from "@/lib/utils";

const COLOR_CLASSES: Record<string, string> = {
  blue: "text-format-badge-blue",
  amber: "text-format-badge-amber",
  emerald: "text-format-badge-emerald",
  rose: "text-format-badge-rose",
  slate: "text-format-badge-slate",
  zinc: "text-format-badge-zinc",
  purple: "text-format-badge-purple",
  teal: "text-format-badge-teal",
  orange: "text-format-badge-orange",
  sky: "text-format-badge-sky",
  indigo: "text-format-badge-indigo",
};

interface FormatBadgeProps {
  formatId: string;
  className?: string;
}

export function FormatBadge({ formatId, className }: FormatBadgeProps) {
  const format = getFormat(formatId);
  if (!format) return null;
  const textColor = COLOR_CLASSES[format.badgeColor] ?? "text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center px-1 py-px rounded text-[10px] font-semibold uppercase tracking-wide bg-muted/60",
        textColor,
        className,
      )}
      title={format.description}
    >
      {format.shortName}
    </span>
  );
}

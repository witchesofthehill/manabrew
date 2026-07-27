import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PartnerBadge({ label, className }: { label: string | null; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-4 max-w-[10rem] shrink-0 truncate px-1 text-[9px]",
        label ? "border-commander/50 text-commander" : "border-warning/50 text-warning",
        className,
      )}
      title={label ?? "Not partners"}
    >
      {label ?? "Not partners"}
    </Badge>
  );
}

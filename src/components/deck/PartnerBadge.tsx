import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PartnerBadge({ label, className }: { label: string | null; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-4 px-1 text-[9px] shrink-0",
        label ? "border-commander/50 text-commander" : "border-warning/50 text-warning",
        className,
      )}
    >
      {label ?? "Not partners"}
    </Badge>
  );
}

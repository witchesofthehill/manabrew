import type { LucideIcon } from "lucide-react";
import { Info, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useStatusBannerStore, type StatusSeverity } from "@/stores/useStatusBannerStore";

const SEVERITY: Record<StatusSeverity, { border: string; accent: string; Icon: LucideIcon }> = {
  info: { border: "border-primary/50", accent: "text-primary", Icon: Info },
  warning: { border: "border-warning/50", accent: "text-warning", Icon: TriangleAlert },
  critical: { border: "border-destructive/60", accent: "text-destructive", Icon: OctagonAlert },
};

export function StatusBanner() {
  const current = useStatusBannerStore((s) => s.current);
  const dismissedIds = useStatusBannerStore((s) => s.dismissedIds);
  const dismiss = useStatusBannerStore((s) => s.dismiss);

  if (!current || dismissedIds.includes(current.id)) return null;

  const { Icon, border, accent } = SEVERITY[current.severity];

  return (
    <div className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-50 w-[min(92vw,32rem)] -translate-x-1/2">
      <div
        className={cn(
          "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card/95 px-3.5 py-2.5 shadow-lg backdrop-blur",
          border,
        )}
      >
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", accent)} />
        <div className="min-w-0 flex-1 text-sm text-foreground">
          <span>{current.message}</span>
          {current.link && (
            <a
              href={current.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn("ml-2 font-semibold underline underline-offset-2", accent)}
            >
              {current.link.label}
            </a>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1 h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => dismiss(current.id)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

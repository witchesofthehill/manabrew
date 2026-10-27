import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CollapsibleDeckShelfProps {
  title: string;
  count: number | string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function CollapsibleDeckShelf({
  title,
  count,
  open,
  onOpenChange,
  children,
}: CollapsibleDeckShelfProps) {
  return (
    <div className="border-t border-border/70 pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none touch:min-h-11 touch:min-w-11 text-ui-label whitespace-normal"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-ui-label font-semibold">{title}</span>
          <span className="text-ui-meta text-muted-foreground">{count}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

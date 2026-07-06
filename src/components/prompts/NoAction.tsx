import { Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobileGame } from "@/hooks/useBreakpoints";

export function NoAction() {
  const minimal = useIsMobileGame();

  if (minimal) {
    return (
      <div className="flex h-8 items-center justify-center px-2 text-muted-foreground">
        <Hourglass className="h-3.5 w-3.5" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-9 w-full items-center justify-center gap-1.5 text-xs text-muted-foreground",
      )}
    >
      <Hourglass className="h-3.5 w-3.5" />
      <span>Waiting for others</span>
    </div>
  );
}

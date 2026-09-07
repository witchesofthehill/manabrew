import { Hourglass } from "lucide-react";
import { useIsMobileGame } from "@/hooks/useBreakpoints";

export function NoAction() {
  const minimal = useIsMobileGame();

  if (minimal) {
    return (
      <div className="flex h-10 items-center justify-center px-2 text-muted-foreground">
        <Hourglass className="h-3.5 w-3.5 animate-hourglass-flip" />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col py-1">
      <div className="flex h-10 w-full items-center justify-center gap-2 text-muted-foreground">
        <Hourglass className="h-3.5 w-3.5 animate-hourglass-flip" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
          Waiting for others
        </span>
      </div>
    </div>
  );
}

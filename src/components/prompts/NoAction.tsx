import { Hourglass } from "lucide-react";

export function NoAction() {
  return (
    <div className="flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground">
      <Hourglass className="h-3.5 w-3.5" />
      <span>Waiting others...</span>
    </div>
  );
}

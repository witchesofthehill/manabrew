import { Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DraftSeat } from "@/types/limited";

interface DraftPodButtonProps {
  seats: DraftSeat[];
}

export function DraftPodButton({ seats }: DraftPodButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-xs">
          <Users className="h-3.5 w-3.5" />
          Pod ({seats.length})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
          Pod
        </DropdownMenuLabel>
        <ul className="space-y-1 px-2 pb-2 text-sm">
          {seats.map((s) => (
            <li key={s.seat} className="flex items-center justify-between gap-3">
              <span className={s.isHuman ? "font-semibold" : ""}>
                {s.seat}. {s.name}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {s.picksMade} pick{s.picksMade === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

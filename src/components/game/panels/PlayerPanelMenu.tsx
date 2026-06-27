import { EllipsisVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGameStore } from "@/stores/useGameStore";

export function PlayerPanelMenu({ playerId, className }: { playerId: string; className?: string }) {
  const hidden = useGameStore((s) => s.hiddenPlaymats.has(playerId));
  const togglePlaymatHidden = useGameStore((s) => s.togglePlaymatHidden);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Player view options"
          className={cn(
            "size-6 rounded-full bg-black/35 p-0 text-white/80 hover:bg-black/60 hover:text-white",
            className,
          )}
        >
          <EllipsisVertical className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuCheckboxItem
          checked={hidden}
          onCheckedChange={() => togglePlaymatHidden(playerId)}
        >
          Hide playmat
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

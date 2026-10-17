import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BuildZone } from "@/components/limited/useLimitedBuildStore";

interface Props {
  availableSelection: string[];
  move: (ids: string[], zone: BuildZone) => void;
  setSelectedIds: (ids: string[]) => void;
}
export function LimitedBuildSelection({ availableSelection, move, setSelectedIds }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0 text-xs tabular-nums">
          Move {availableSelection.length} selected
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => move(availableSelection, "main")}>
          To Mainboard
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => move(availableSelection, "pool")}>
          To Pool
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => move(availableSelection, "sideboard")}>
          To Sideboard
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => move(availableSelection, "maybe")}>
          To Maybeboard
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setSelectedIds([])}>Clear selection</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

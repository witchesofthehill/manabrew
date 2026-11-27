import { AlertTriangle, ChevronDown, CircleDollarSign, LibraryBig, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
interface DeckStatusSummaryProps {
  legalityErrors: number;
  unsupportedCards: number;
  collectionGaps: number;
  budgetTracked: boolean;
  onNavigate: (target: "validation" | "unsupported" | "collection" | "budget") => void;
}
export function DeckStatusSummary({
  legalityErrors,
  unsupportedCards,
  collectionGaps,
  budgetTracked,
  onNavigate,
}: DeckStatusSummaryProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground">
          Deck checks <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <StatusItem
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label={`Format legality`}
          value={legalityErrors > 0 ? `${legalityErrors} issues` : "Legal"}
          warning={legalityErrors > 0}
          onSelect={() => onNavigate("validation")}
        />
        <StatusItem
          icon={<Wrench className="h-3.5 w-3.5" />}
          label={`Engine support`}
          value={unsupportedCards > 0 ? `${unsupportedCards} unsupported` : "None flagged"}
          warning={unsupportedCards > 0}
          onSelect={() => onNavigate(unsupportedCards > 0 ? "unsupported" : "validation")}
        />
        <StatusItem
          icon={<LibraryBig className="h-3.5 w-3.5" />}
          label={`Collection`}
          value={collectionGaps > 0 ? `${collectionGaps} gaps` : "Complete"}
          onSelect={() => onNavigate("collection")}
        />
        <StatusItem
          icon={<CircleDollarSign className="h-3.5 w-3.5" />}
          label={`Budget`}
          value={budgetTracked ? "Tracked" : "Not set"}
          onSelect={() => onNavigate("budget")}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function StatusItem({
  icon,
  label,
  value,
  warning = false,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  warning?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      className="flex-wrap gap-2 text-ui-label touch:min-h-11 touch:min-w-11"
      onSelect={onSelect}
    >
      <span className={cn(warning ? "text-warning" : "text-muted-foreground")}>{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      <span className={cn("text-ui-meta", warning ? "text-warning" : "text-muted-foreground")}>
        {value}
      </span>
    </DropdownMenuItem>
  );
}

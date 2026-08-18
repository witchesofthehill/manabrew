import { AlertTriangle, CheckCircle2, CircleDollarSign, LibraryBig, Wrench } from "lucide-react";
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
  onNavigate: (target: "validation" | "collection" | "budget") => void;
}

export function DeckStatusSummary({
  legalityErrors,
  unsupportedCards,
  collectionGaps,
  budgetTracked,
  onNavigate,
}: DeckStatusSummaryProps) {
  const issueCount = legalityErrors + unsupportedCards;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 shrink-0 gap-1.5 text-xs",
            issueCount > 0 ? "text-warning" : "text-legality-legal",
          )}
        >
          {issueCount > 0 ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {issueCount > 0 ? `${issueCount} to review` : "Deck healthy"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <StatusItem
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Format legality"
          value={legalityErrors > 0 ? `${legalityErrors} issues` : "Legal"}
          warning={legalityErrors > 0}
          onSelect={() => onNavigate("validation")}
        />
        <StatusItem
          icon={<Wrench className="h-3.5 w-3.5" />}
          label="Engine support"
          value={unsupportedCards > 0 ? `${unsupportedCards} unsupported` : "Supported"}
          warning={unsupportedCards > 0}
          onSelect={() => onNavigate("validation")}
        />
        <StatusItem
          icon={<LibraryBig className="h-3.5 w-3.5" />}
          label="Collection"
          value={collectionGaps > 0 ? `${collectionGaps} gaps` : "Complete"}
          onSelect={() => onNavigate("collection")}
        />
        <StatusItem
          icon={<CircleDollarSign className="h-3.5 w-3.5" />}
          label="Budget"
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
    <DropdownMenuItem className="gap-2" onSelect={onSelect}>
      <span className={cn(warning ? "text-warning" : "text-muted-foreground")}>{icon}</span>
      <span className="flex-1">{label}</span>
      <span className={cn("text-xs", warning ? "text-warning" : "text-muted-foreground")}>
        {value}
      </span>
    </DropdownMenuItem>
  );
}

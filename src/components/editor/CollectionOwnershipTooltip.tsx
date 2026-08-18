import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, Layers3 } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROUTES } from "@/lib/constants";
import { collectionCardKey } from "@/lib/collection";
import { cn } from "@/lib/utils";
import type { DeckCard } from "@/protocol/deck";
import {
  useCardCollectionOwnership,
  useCardCollectionPrintings,
  useDeckCardOwnership,
} from "./useCardCollectionOwnership";

export function CollectionOwnershipTooltip({
  card,
  surface,
  className,
}: {
  card: DeckCard;
  surface: "visual" | "text";
  className?: string;
}) {
  const ownership = useCardCollectionOwnership(card);
  const summary = useDeckCardOwnership(card);
  const printings = useCardCollectionPrintings(card);
  if (ownership === "none" || !summary) return null;

  const requiredPrinting = printingLabel(
    card.identity.setCode,
    card.identity.cardNumber,
    card.identity.foil,
  );
  const exactKeys = new Set([
    collectionCardKey(
      card.identity.name,
      card.identity.setCode,
      card.identity.cardNumber,
      card.identity.foil ?? false,
    ),
    ...(!card.identity.foil
      ? [collectionCardKey(card.identity.name, card.identity.setCode, card.identity.cardNumber)]
      : []),
  ]);

  return (
    <Tooltip delayDuration={180}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "z-40 flex shrink-0 items-center justify-center rounded-full shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            surface === "visual" ? "absolute left-7 top-1 h-5 min-w-5" : "h-5 w-8",
            ownership === "exact"
              ? "bg-legality-legal text-primary-foreground"
              : "bg-primary text-primary-foreground",
            className,
          )}
          aria-label={
            ownership === "exact"
              ? `Exact printing of ${card.identity.name} owned`
              : `Another printing of ${card.identity.name} owned`
          }
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {ownership === "exact" ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Layers3 className="h-3.5 w-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="w-80 space-y-3 rounded-xl bg-popover p-4 text-popover-foreground shadow-xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          {ownership === "exact" ? (
            <CheckCircle2 className="h-4 w-4 text-legality-legal" />
          ) : (
            <Layers3 className="h-4 w-4 text-primary" />
          )}
          <div className="min-w-0">
            <p className="font-semibold">Collection tracker</p>
            <p className="text-[11px] text-muted-foreground">
              {ownership === "exact" ? "Exact printing owned" : "Owned in another printing"}
            </p>
          </div>
          <span className="ml-auto font-mono text-xs tabular-nums">
            {Math.min(summary.owned, summary.required)}/{summary.required}
          </span>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Needed for deck
          </p>
          <PrintingRow quantity={summary.required} label={requiredPrinting} exact />
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Found in collection
          </p>
          {printings.map((printing, index) => {
            const key = collectionCardKey(
              card.identity.name,
              printing.setCode,
              printing.collectorNumber,
              printing.foil,
            );
            return (
              <PrintingRow
                key={`${key}-${index}`}
                quantity={printing.quantity}
                label={printingLabel(printing.setCode, printing.collectorNumber, printing.foil)}
                exact={exactKeys.has(key)}
              />
            );
          })}
        </div>

        <Link
          to={`${ROUTES.MY_COLLECTION}?q=${encodeURIComponent(card.identity.name)}`}
          className="flex items-center justify-center gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => event.stopPropagation()}
        >
          View in My Collection <ExternalLink className="h-3 w-3" />
        </Link>
      </TooltipContent>
    </Tooltip>
  );
}

function PrintingRow({
  quantity,
  label,
  exact,
}: {
  quantity: number;
  label: string;
  exact: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/25 px-2 py-1.5">
      <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums">{quantity}</span>
      <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
      <span className={cn("text-[10px]", exact ? "text-legality-legal" : "text-muted-foreground")}>
        {exact ? "exact" : "other"}
      </span>
    </div>
  );
}

function printingLabel(setCode?: string, collectorNumber?: string, foil?: boolean): string {
  if (!setCode || !collectorNumber) return "Unspecified printing";
  return `${setCode.toUpperCase()} #${collectorNumber} · ${foil ? "foil" : "nonfoil"}`;
}

import { Crown, Plus, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  canBeOathbreaker,
  canBePartnerCommander,
  canBePartners,
  canBeSignatureSpell,
  commanderSlotBadge,
  formatRequiresCommander,
  isCommanderEligible,
} from "@/lib/formats";
import type { DeckCard, DeckFormat } from "@/protocol/deck";

interface CommanderSlotsProps {
  cards: DeckCard[];
  commanders: DeckCard[];
  format: DeckFormat;
  readOnly: boolean;
  onSetCommander: (card: DeckCard) => void;
  onRemoveCommander: (card: DeckCard) => void;
  onHover?: (card: DeckCard, event: ReactPointerEvent<HTMLElement>) => void;
  onLeave?: () => void;
}

export function CommanderSlots({
  cards,
  commanders,
  format,
  readOnly,
  onSetCommander,
  onRemoveCommander,
  onHover,
  onLeave,
}: CommanderSlotsProps) {
  if (!formatRequiresCommander(format)) return null;

  const oathbreakers = commanders.filter((card) => canBeOathbreaker(card));
  const signatureSpells = commanders.filter((card) => canBeSignatureSpell(card));
  const oathbreakerTarget =
    oathbreakers.length === 0
      ? "oathbreaker"
      : signatureSpells.length < oathbreakers.length
        ? "signature"
        : oathbreakers.length === 1 && canBePartnerCommander(oathbreakers[0])
          ? "partner"
          : null;
  const candidates = cards.filter((card) => {
    if (format === "oathbreaker") {
      if (oathbreakerTarget === "signature") return canBeSignatureSpell(card);
      if (oathbreakerTarget === "partner") return canBePartners(oathbreakers[0], card);
      return oathbreakerTarget === "oathbreaker" && canBeOathbreaker(card);
    }
    if (!isCommanderEligible(card)) return false;
    return commanders.length === 0 || canBePartners(commanders[0], card);
  });
  const canAddAnother =
    (format === "oathbreaker" && oathbreakerTarget !== null) ||
    commanders.length === 0 ||
    (commanders.length === 1 && canBePartnerCommander(commanders[0]));
  const emptyLabel =
    format === "oathbreaker"
      ? oathbreakerTarget === "signature"
        ? "Choose signature spell"
        : oathbreakerTarget === "partner"
          ? "Choose partner"
          : "Choose oathbreaker"
      : commanders.length > 0
        ? "Choose partner"
        : "Choose commander";

  return (
    <section className="border-b bg-muted/15 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <Crown className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wide">Command zone</h3>
        <span className="text-xs text-muted-foreground">Set your deck identity</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {commanders.map((card, index) => (
          <div
            key={card.identity.id}
            className="flex min-h-10 items-center gap-2 rounded-md border bg-background/70 px-3 py-1.5"
            onPointerEnter={(event) => {
              if (event.pointerType !== "touch") onHover?.(card, event);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== "touch") onLeave?.();
            }}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{card.identity.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {commanderSlotBadge(commanders, format, index)?.label ??
                  (format === "oathbreaker" ? "Oathbreaker" : "Commander")}
              </div>
            </div>
            {!readOnly && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="ml-1 h-7 w-7 shrink-0"
                title={`Remove ${card.identity.name} from the command zone`}
                onClick={() => onRemoveCommander(card)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
        {!readOnly && canAddAnother && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="min-h-10 gap-2 border-dashed">
                <Plus className="h-3.5 w-3.5" />
                {emptyLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-72 overflow-y-auto">
              {candidates.length > 0 ? (
                candidates.map((card) => (
                  <DropdownMenuItem
                    key={card.identity.id}
                    onSelect={() => onSetCommander(card)}
                    onPointerEnter={(event) => {
                      if (event.pointerType !== "touch") onHover?.(card, event);
                    }}
                    onPointerLeave={(event) => {
                      if (event.pointerType !== "touch") onLeave?.();
                    }}
                  >
                    <span className="truncate">{card.identity.name}</span>
                  </DropdownMenuItem>
                ))
              ) : (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Add an eligible card to the deck first.
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </section>
  );
}

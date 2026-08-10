import { Crown, Palette, Plus, X } from "lucide-react";
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
import { CARD_WIDTH_MAP } from "./deckBuilder.utils";
import { CardThumbnail } from "./deckEditor.primitives";

interface CommanderSlotsProps {
  cards: DeckCard[];
  commanders: DeckCard[];
  format: DeckFormat;
  cardSize: number;
  readOnly: boolean;
  onSetCommander: (card: DeckCard) => void;
  onRemoveCommander: (card: DeckCard) => void;
  onHover?: (card: DeckCard, event: ReactPointerEvent<HTMLElement>) => void;
  onLeave?: () => void;
  onPickPrint?: (cardName: string) => void;
}

export function CommanderSlots({
  cards,
  commanders,
  format,
  cardSize,
  readOnly,
  onSetCommander,
  onRemoveCommander,
  onHover,
  onLeave,
  onPickPrint,
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
  const cardWidth = CARD_WIDTH_MAP[cardSize] ?? 115;

  return (
    <section className="border-b bg-muted/15 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <Crown className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wide">Command zone</h3>
        <span className="text-xs text-muted-foreground">Set your deck identity</span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {commanders.map((card, index) => (
          <div
            key={card.identity.id}
            className="group relative shrink-0"
            style={{ width: cardWidth }}
            onPointerEnter={(event) => {
              if (event.pointerType !== "touch") onHover?.(card, event);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== "touch") onLeave?.();
            }}
          >
            <CardThumbnail card={card} />
            <div className="absolute left-1 top-1 z-20 rounded bg-overlay/75 px-1.5 py-0.5 text-[10px] font-semibold text-foreground shadow">
              {commanderSlotBadge(commanders, format, index)?.label ??
                (format === "oathbreaker" ? "Oathbreaker" : "Commander")}
            </div>
            {!readOnly && (
              <div className="absolute right-1 top-1 z-20 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100">
                {onPickPrint && (
                  <button
                    type="button"
                    className="rounded-full bg-overlay/70 p-0.5 text-muted-foreground shadow transition-colors hover:text-foreground"
                    title="Change printing"
                    aria-label={`Change printing for ${card.identity.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPickPrint(card.identity.name);
                    }}
                  >
                    <Palette className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-full bg-overlay/70 p-0.5 text-muted-foreground shadow transition-colors hover:text-destructive"
                  title={`Remove ${card.identity.name} from the command zone`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveCommander(card);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
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

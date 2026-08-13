import { AlertTriangle, ChevronDown, Crown, Palette, Plus, X } from "lucide-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

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
import { CARD_WIDTH_MAP, DEFAULT_CARD_SIZE } from "./deckBuilder.utils";
import { CardThumbnail } from "./deckEditor.primitives";
import { DROP_ZONE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useIsUnsupported } from "@/stores/useCardSupportStore";
import { useCardCollectionOwnership } from "./useCardCollectionOwnership";

function CommandZoneCard({
  card,
  label,
  cardWidth,
  readOnly,
  onRemove,
  onHover,
  onLeave,
  onPickPrint,
}: {
  card: DeckCard;
  label: string;
  cardWidth: number;
  readOnly: boolean;
  onRemove: () => void;
  onHover?: (card: DeckCard, event: ReactPointerEvent<HTMLElement>) => void;
  onLeave?: () => void;
  onPickPrint?: (cardName: string) => void;
}) {
  const unsupported = useIsUnsupported(card.identity.name);
  const ownership = useCardCollectionOwnership(card);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `deck-commander-${card.identity.name}`,
    data: { type: "deck-card", card, name: card.identity.name },
    disabled: readOnly,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "group relative shrink-0 touch-none",
        !readOnly && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-30",
        unsupported && "rounded-lg ring-2 ring-warning/70",
        ownership === "exact" && "rounded-lg outline outline-2 outline-legality-legal/60",
        ownership === "other" && "rounded-lg outline-dashed outline outline-1 outline-primary/60",
      )}
      style={{ width: cardWidth }}
      data-card-ownership={ownership}
      title={
        ownership === "exact"
          ? "Exact printing owned"
          : ownership === "other"
            ? "Owned in another printing"
            : undefined
      }
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onHover?.(card, event);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") onLeave?.();
      }}
    >
      <CardThumbnail card={card} />
      {unsupported && (
        <div
          className="absolute bottom-1 right-1 z-30 rounded-full bg-warning/90 p-0.5 text-white shadow"
          title="Unsupported by the Manabrew and Forge engines"
        >
          <AlertTriangle className="h-3 w-3" />
        </div>
      )}
      <div className="absolute left-1 top-1 z-20 rounded bg-overlay/75 px-1.5 py-0.5 text-[10px] font-semibold text-foreground shadow">
        {label}
      </div>
      {!readOnly && (
        <div className="absolute right-1 top-1 z-20 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100">
          {onPickPrint && (
            <button
              type="button"
              className="rounded-full bg-overlay/70 p-0.5 text-muted-foreground shadow transition-colors hover:text-foreground"
              title="Change printing"
              aria-label={`Change printing for ${card.identity.name}`}
              onPointerDown={(event) => event.stopPropagation()}
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
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

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
  const [open, setOpen] = useState(true);
  const { setNodeRef, isOver } = useDroppable({
    id: DROP_ZONE.COMMAND,
    disabled: readOnly || !formatRequiresCommander(format),
  });
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
  const cardWidth = CARD_WIDTH_MAP[cardSize] ?? CARD_WIDTH_MAP[DEFAULT_CARD_SIZE];

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "border-b bg-muted/15 px-3 py-2 transition-colors",
        isOver && "bg-primary/10 ring-2 ring-inset ring-primary/50",
      )}
    >
      <button
        type="button"
        className="mb-1.5 flex items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />
        <Crown className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wide">Command zone</h3>
        <span className="text-xs text-muted-foreground">Set your deck identity</span>
      </button>
      {open && (
        <div className="flex flex-wrap items-start gap-2">
          {commanders.map((card, index) => (
            <CommandZoneCard
              key={card.identity.id}
              card={card}
              label={
                commanderSlotBadge(commanders, format, index)?.label ??
                (format === "oathbreaker" ? "Oathbreaker" : "Commander")
              }
              cardWidth={cardWidth}
              readOnly={readOnly}
              onRemove={() => onRemoveCommander(card)}
              onHover={onHover}
              onLeave={onLeave}
              onPickPrint={onPickPrint}
            />
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
      )}
    </section>
  );
}

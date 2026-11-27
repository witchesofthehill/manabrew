import { Plus } from "lucide-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  canBeOathbreaker,
  canBePartnerCommander,
  canBePartners,
  canBeSignatureSpell,
  commanderSlotBadge,
  formatRequiresCommander,
  isLegalCommander,
} from "@/lib/formats";
import type { DeckCard, DeckFormat } from "@/protocol/deck";
import { CARD_WIDTH_MAP, DEFAULT_CARD_SIZE, type ViewMode } from "./deckBuilder.utils";
import { SectionHeader } from "./deckEditor.primitives";
import { DROP_ZONE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { CommandZoneCard } from "./CommandZoneCard";
import type { CommandZoneCardMenuActions } from "./CommandZoneCardMenu";
import { useDeckSectionOpen } from "./deckSectionExpansion";
interface CommanderSlotsProps {
  cards: DeckCard[];
  commanders: DeckCard[];
  format: DeckFormat;
  cardSize: number;
  viewMode: ViewMode;
  readOnly: boolean;
  onSetCommander: (card: DeckCard) => void;
  onHover?: (card: DeckCard, event: ReactPointerEvent<HTMLElement>) => void;
  onLeave?: () => void;
  onShowInfo: (card: DeckCard) => void;
  contextMenuFor?: (card: DeckCard, label: string) => CommandZoneCardMenuActions;
  onBrowseCommanders?: () => void;
}
export function CommanderSlots({
  cards,
  commanders,
  format,
  cardSize,
  viewMode,
  readOnly,
  onSetCommander,
  onHover,
  onLeave,
  onShowInfo,
  contextMenuFor,
  onBrowseCommanders,
}: CommanderSlotsProps) {
  const [open, setOpen] = useDeckSectionOpen();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
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
    if (!isLegalCommander(card, format)) return false;
    return commanders.length === 0 || canBePartners(commanders[0], card);
  });
  const canAddAnother =
    (format === "oathbreaker" && oathbreakerTarget !== null) ||
    commanders.length === 0 ||
    (commanders.length === 1 && canBePartnerCommander(commanders[0]));
  const emptyLabel =
    format === "oathbreaker"
      ? oathbreakerTarget === "signature"
        ? `Choose signature spell`
        : oathbreakerTarget === "partner"
          ? `Choose partner`
          : `Choose oathbreaker`
      : commanders.length > 0
        ? "Choose partner"
        : "Choose commander";
  const cardWidth = CARD_WIDTH_MAP[cardSize] ?? CARD_WIDTH_MAP[DEFAULT_CARD_SIZE];
  const stack = viewMode === "stack";
  const cardHeight = Math.round(cardWidth * 1.4);
  const peek = Math.max(44, Math.round(cardHeight * 0.22));
  return (
    <section
      ref={setNodeRef}
      data-command-zone
      className={cn(
        "min-w-0 rounded transition-colors",
        stack ? "mb-5" : "mb-3 break-inside-avoid",
        isOver && "bg-primary/10 ring-2 ring-inset ring-primary/50",
      )}
    >
      <SectionHeader
        label="Command zone"
        count={commanders.length}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      {open && (
        <>
          {commanders.length > 0 && (
            <div
              className={
                stack ? "grid" : viewMode === "list" ? "space-y-0.5" : "flex flex-wrap gap-2"
              }
              onPointerLeave={stack ? () => setHoveredIndex(null) : undefined}
              onBlur={
                stack
                  ? (event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setHoveredIndex(null);
                    }
                  : undefined
              }
            >
              {commanders.map((card, index) => {
                const label =
                  commanderSlotBadge(commanders, format, index)?.label ??
                  (format === "oathbreaker" ? "Oathbreaker" : "Commander");
                return (
                  <CommandZoneCard
                    key={card.identity.id}
                    card={card}
                    label={label}
                    viewMode={viewMode}
                    cardWidth={cardWidth}
                    stackOffset={
                      stack
                        ? index * peek +
                          (hoveredIndex !== null && index > hoveredIndex ? cardHeight - peek : 0)
                        : 0
                    }
                    onStackHover={stack ? () => setHoveredIndex(index) : undefined}
                    readOnly={readOnly}
                    onShowInfo={() => onShowInfo(card)}
                    menuActions={readOnly ? undefined : contextMenuFor?.(card, label.toLowerCase())}
                  />
                );
              })}
            </div>
          )}
          {!readOnly && canAddAnother && (
            <div className={cn("flex flex-wrap gap-1.5", commanders.length > 0 && "mt-2")}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="touch:min-h-11 h-auto min-h-7 max-w-full gap-1.5 whitespace-normal border-dashed text-left"
                  >
                    <Plus className="size-3.5 shrink-0" />
                    <span className="min-w-0 wrap-break-word">{emptyLabel}</span>
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
                    <div className="px-2 py-3 text-ui-meta text-muted-foreground">
                      {onBrowseCommanders
                        ? "No eligible cards in this deck."
                        : "Add an eligible card to the deck first."}
                    </div>
                  )}
                  {onBrowseCommanders && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={onBrowseCommanders}>
                        Browse cards
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {candidates.length === 0 && onBrowseCommanders && (
                <Button
                  variant="outline"
                  size="sm"
                  className="touch:min-h-11 h-auto min-h-7 max-w-full whitespace-normal"
                  onClick={onBrowseCommanders}
                >
                  Browse cards
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

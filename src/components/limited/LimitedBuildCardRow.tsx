import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLongPressPreview } from "@/hooks/useLongPressPreview";
import { useDeckCard } from "@/lib/limited.utils";
import { deckCardToPreviewDto } from "@/lib/scryfall.utils";
import { cn } from "@/lib/utils";
import type { DraftCard } from "@/types/limited";
import type { BuildZone } from "@/components/limited/useLimitedBuildStore";
import type { CardDto } from "@/protocol/game";

interface Props {
  card: DraftCard;
  selected: boolean;
  zone: BuildZone;
  onSelect: (card: DraftCard, additive: boolean) => void;
  onMove: (ids: string[], zone: BuildZone) => void;
  onInspect: (card: CardDto, anchor: HTMLElement | DOMRect) => void;
  onHover: (card: CardDto, event: MouseEvent) => void;
  onLeave: () => void;
  onDismiss: () => void;
}
export function LimitedBuildCardRow({
  card,
  selected,
  onSelect,
  onMove,
  zone,
  onInspect,
  onHover,
  onLeave,
  onDismiss,
}: Props) {
  const deckCard = useDeckCard(card);
  const dto = deckCard ? deckCardToPreviewDto(deckCard) : null;
  const longPress = useLongPressPreview({
    resolve: (event) => (dto ? { item: dto, anchor: event.currentTarget as HTMLElement } : null),
    show: onInspect,
    hide: onDismiss,
    hideOnRelease: false,
  });
  return (
    <li
      className={cn(
        "flex items-center gap-1 rounded bg-card/70 px-2 py-1",
        selected && "bg-selection/20 ring-1 ring-selection",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        className="min-h-11 min-w-0 flex-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary"
        onClick={(event) => onSelect(card, event.shiftKey || event.metaKey || event.ctrlKey)}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch" && dto) onHover(dto, event);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") onLeave();
        }}
        {...longPress}
      >
        <span className="block truncate font-medium">
          {card.name}
          {card.foil ? " · Foil" : ""}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {card.setCode.toUpperCase()} {card.cardNumber}
        </span>
      </button>
      <Button
        variant="ghost"
        size="sm"
        disabled={!dto}
        aria-label={`Inspect ${card.name}`}
        onClick={(event) => {
          if (dto) onInspect(dto, event.currentTarget);
        }}
      >
        Inspect
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label={`Move ${card.name} to another zone`}>
            Move
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {zone !== "pool" && (
            <DropdownMenuItem onSelect={() => onMove([card.id], "pool")}>To Pool</DropdownMenuItem>
          )}
          {zone !== "main" && (
            <DropdownMenuItem onSelect={() => onMove([card.id], "main")}>
              To Mainboard
            </DropdownMenuItem>
          )}
          {zone !== "sideboard" && (
            <DropdownMenuItem onSelect={() => onMove([card.id], "sideboard")}>
              To Sideboard
            </DropdownMenuItem>
          )}
          {zone !== "maybe" && (
            <DropdownMenuItem onSelect={() => onMove([card.id], "maybe")}>
              To Maybeboard
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

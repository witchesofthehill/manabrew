import { Bookmark, Plus, X } from "lucide-react";

import { ScryfallImg } from "@/components/ScryfallImg";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ScryfallCard } from "@/types/scryfall";

import type { DeckQuickAddRequest } from "./deckQuickAdd.parser";

interface DeckQuickAddOptionsProps {
  card: ScryfallCard;
  quantity: number;
  destination: DeckQuickAddRequest["destination"];
  tags: string[];
  customTags: string[];
  onQuantityChange: (quantity: number) => void;
  onDestinationChange: (destination: DeckQuickAddRequest["destination"]) => void;
  onTagsChange: (tags: string[]) => void;
  onAdd: () => void;
  onClose: () => void;
}

export function DeckQuickAddOptions({
  card,
  quantity,
  destination,
  tags,
  customTags,
  onQuantityChange,
  onDestinationChange,
  onTagsChange,
  onAdd,
  onClose,
}: DeckQuickAddOptionsProps) {
  const thumbnail = card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
  const availableTags = [...tags, ...customTags].filter(
    (tag, index, all) =>
      all.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase()) === index,
  );

  function toggleTag(tag: string) {
    const selected = tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase());
    onTagsChange(
      selected
        ? tags.filter((candidate) => candidate.toLowerCase() !== tag.toLowerCase())
        : [...tags, tag],
    );
  }

  return (
    <div className="absolute left-0 top-full z-50 mt-1 min-w-80 rounded-md border bg-popover p-2 text-popover-foreground shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        {thumbnail && (
          <ScryfallImg
            src={thumbnail}
            alt=""
            className="h-9 w-7 shrink-0 rounded object-cover object-top"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{card.name}</div>
          <div className="text-[10px] text-muted-foreground">Configure addition</div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Close options"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex items-center gap-1">
        <label className="flex h-7 shrink-0 items-center rounded border bg-muted/40 px-1 text-[10px] text-muted-foreground">
          <input
            autoFocus
            type="number"
            min={1}
            max={99}
            value={quantity}
            className="w-8 bg-transparent text-center text-xs font-medium text-foreground outline-none"
            title="Quantity"
            onChange={(event) =>
              onQuantityChange(Math.max(1, Math.min(99, Number(event.target.value) || 1)))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") onAdd();
            }}
          />
          ×
        </label>
        <select
          value={destination}
          className="h-7 shrink-0 rounded border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          title="Deck section"
          onChange={(event) =>
            onDestinationChange(event.target.value as DeckQuickAddRequest["destination"])
          }
        >
          <option value="main">Main</option>
          <option value="side">Side</option>
          <option value="maybe">Maybe</option>
        </select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1 px-2"
              title="Choose deck tags"
            >
              <Bookmark className="h-3 w-3" />
              {tags.length > 0 ? tags.length : "Tag"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {availableTags.length > 0 ? (
              availableTags.map((tag) => (
                <DropdownMenuCheckboxItem
                  key={tag}
                  checked={tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase())}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => toggleTag(tag)}
                >
                  {tag}
                </DropdownMenuCheckboxItem>
              ))
            ) : (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No deck tags yet</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" size="sm" className="h-7 shrink-0 gap-1 px-2" onClick={onAdd}>
          <Plus className="h-3 w-3" />
          Add {quantity}
        </Button>
      </div>
    </div>
  );
}

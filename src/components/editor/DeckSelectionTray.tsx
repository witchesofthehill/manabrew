import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bookmark,
  BookmarkMinus,
  ChevronDown,
  Images,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DeckSelectionTrayProps {
  count: number;
  tags: string[];
  appliedTags: string[];
  onMoveToMain: () => void;
  onMoveToSide: () => void;
  onTag: (tag: string) => void;
  onUntag: (tag: string) => void;
  onPrinting: () => void;
  onRemove: () => void;
  onClear: () => void;
}

export function DeckSelectionTray({
  count,
  tags,
  appliedTags,
  onMoveToMain,
  onMoveToSide,
  onTag,
  onUntag,
  onPrinting,
  onRemove,
  onClear,
}: DeckSelectionTrayProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 flex flex-wrap items-center gap-2 border-t border-selection/30 bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
      <div className="mr-2">
        <div className="text-sm font-medium text-selection">
          {count} card{count !== 1 ? "s" : ""} selected
        </div>
        <div className="text-[10px] text-muted-foreground">Bulk editor</div>
      </div>
      <Button size="sm" variant="outline" onClick={onMoveToMain}>
        <ArrowUpToLine className="mr-1 h-3 w-3" /> Main
      </Button>
      <Button size="sm" variant="outline" onClick={onMoveToSide}>
        <ArrowDownToLine className="mr-1 h-3 w-3" /> Sideboard
      </Button>
      {tags.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Bookmark className="mr-1 h-3 w-3" /> Tag
              <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {tags.map((tag) => (
              <DropdownMenuItem key={tag} onSelect={() => onTag(tag)}>
                <Bookmark className="mr-2 h-3 w-3 text-primary/60" /> {tag}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {appliedTags.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <BookmarkMinus className="mr-1 h-3 w-3" /> Untag
              <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {appliedTags.map((tag) => (
              <DropdownMenuItem key={tag} onSelect={() => onUntag(tag)}>
                <BookmarkMinus className="mr-2 h-3 w-3 text-destructive" /> {tag}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button size="sm" variant="outline" onClick={onPrinting}>
        <Images className="mr-1 h-3 w-3" /> Printing
      </Button>
      <div className="flex-1" />
      <Button size="sm" variant="destructive" onClick={onRemove}>
        <X className="mr-1 h-3 w-3" /> Remove
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

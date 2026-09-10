import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bookmark,
  BookmarkMinus,
  ChevronDown,
  ClipboardCopy,
  Images,
  Minus,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface DeckSelectionTrayProps {
  count: number;
  tags: string[];
  appliedTags: string[];
  onMoveToMain: () => void;
  onMoveToSide: () => void;
  onMoveToMaybe: () => void;
  onAddCopy: () => void;
  onRemoveCopy: () => void;
  onToggleFoil: () => void;
  onCopy: () => void;
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
  onMoveToMaybe,
  onAddCopy,
  onRemoveCopy,
  onToggleFoil,
  onCopy,
  onTag,
  onUntag,
  onPrinting,
  onRemove,
  onClear,
}: DeckSelectionTrayProps) {
  return (
    <section
      className="absolute bottom-0 left-0 right-0 z-50 border-t border-selection/30 bg-background/95 px-3 pb-[calc(var(--safe-area-inset-bottom)+0.75rem)] pt-2 shadow-lg backdrop-blur sm:px-4 sm:pb-2"
      aria-label={i18n._(msg`Actions for selected cards`)}
    >
      <div className="mb-2 flex items-center sm:hidden">
        <div className="min-w-0 flex-1 text-sm font-medium text-selection">
          <Trans>
            {count} card{count !== 1 ? "s" : ""} selected
          </Trans>
        </div>
        <Button size="sm" variant="ghost" className="h-9" onClick={onClear}>
          <Trans>Clear</Trans>
        </Button>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        <div className="mr-2 hidden sm:block">
          <div className="text-sm font-medium text-selection">
            <Trans>
              {count} card{count !== 1 ? "s" : ""} selected
            </Trans>
          </div>
          <div className="text-[10px] text-muted-foreground">
            <Trans>Bulk editor</Trans>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-10 shrink-0 sm:h-8">
              <Trans>
                <ArrowUpToLine className="mr-1 h-3 w-3" /> Move
                <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
              </Trans>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onMoveToMain}>
              <Trans>
                <ArrowUpToLine className="mr-2 h-3.5 w-3.5" /> Main deck
              </Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onMoveToSide}>
              <Trans>
                <ArrowDownToLine className="mr-2 h-3.5 w-3.5" /> Sideboard
              </Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onMoveToMaybe}>
              <Trans>Maybeboard</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-10 shrink-0 sm:h-8">
              <Trans>
                Quantity <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
              </Trans>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onAddCopy}>
              <Trans>
                <Plus className="mr-2 h-3.5 w-3.5" /> Add one each
              </Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRemoveCopy}>
              <Trans>
                <Minus className="mr-2 h-3.5 w-3.5" /> Remove one each
              </Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {tags.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-10 shrink-0 sm:h-8">
                <Trans>
                  <Bookmark className="mr-1 h-3 w-3" /> Tag
                  <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
                </Trans>
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
              <Button size="sm" variant="outline" className="h-10 shrink-0 sm:h-8">
                <Trans>
                  <BookmarkMinus className="mr-1 h-3 w-3" /> Untag
                  <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
                </Trans>
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
        <Button size="sm" variant="outline" className="h-10 shrink-0 sm:h-8" onClick={onPrinting}>
          <Trans>
            <Images className="mr-1 h-3 w-3" /> Printing
          </Trans>
        </Button>
        <Button size="sm" variant="outline" className="h-10 shrink-0 sm:h-8" onClick={onToggleFoil}>
          <Trans>
            <Sparkles className="mr-1 h-3 w-3" /> Foil
          </Trans>
        </Button>
        <Button size="sm" variant="outline" className="h-10 shrink-0 sm:h-8" onClick={onCopy}>
          <Trans>
            <ClipboardCopy className="mr-1 h-3 w-3" /> Copy
          </Trans>
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="destructive" className="h-10 shrink-0 sm:h-8" onClick={onRemove}>
          <Trans>
            <X className="mr-1 h-3 w-3" /> Remove
          </Trans>
        </Button>
        <Button size="sm" variant="ghost" className="hidden sm:inline-flex" onClick={onClear}>
          <Trans>Clear</Trans>
        </Button>
      </div>
    </section>
  );
}

import {
  Bookmark,
  BookOpen,
  ClipboardCopy,
  Command,
  EllipsisVertical,
  FileBox,
  FilePenLine,
  History,
  ImagePlus,
  Images,
  ListPlus,
  Palette,
  Sparkles,
  Share2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DeckActionsMenuProps {
  hasCards: boolean;
  canPublish: boolean;
  onEditText: () => void;
  onImport: () => void;
  onExport: () => void;
  onExactExport: () => void;
  onDraft: () => void;
  onCheckpoints: () => void;
  onLabels: () => void;
  onTags: () => void;
  onPlaymat: () => void;
  onPrintings: () => void;
  onOptimizePrintings: () => void;
  onPublish?: () => void;
  onCommands: () => void;
  onGuide: () => void;
  onDelete: () => void;
}

export function DeckActionsMenu({
  hasCards,
  canPublish,
  onEditText,
  onImport,
  onExport,
  onExactExport,
  onDraft,
  onCheckpoints,
  onLabels,
  onTags,
  onPlaymat,
  onPrintings,
  onOptimizePrintings,
  onPublish,
  onCommands,
  onGuide,
  onDelete,
}: DeckActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Deck actions" title="Deck actions">
          <EllipsisVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={onEditText}>
          <FilePenLine /> Edit as text
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onImport}>
          <ListPlus /> Import list
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExport} disabled={!hasCards}>
          <ClipboardCopy /> Copy deck list
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExactExport} disabled={!hasCards}>
          <Images /> Copy exact printings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLabels}>
          <Palette /> Deck labels
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onTags}>
          <Bookmark /> Manage card tags
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onPlaymat}>
          <ImagePlus /> Edit playmat
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onPrintings}>
          <Images /> Change deck printings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOptimizePrintings}>
          <Sparkles /> Optimize deck printings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDraft}>
          <FileBox /> Save as draft
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCheckpoints}>
          <History /> Local checkpoints
        </DropdownMenuItem>
        {onPublish && (
          <DropdownMenuItem onSelect={onPublish} disabled={!canPublish}>
            <Share2 /> Publish to Community
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCommands}>
          <Command /> Command palette
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onGuide}>
          <BookOpen /> Deck editor guide
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
          <Trash2 /> Delete deck
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

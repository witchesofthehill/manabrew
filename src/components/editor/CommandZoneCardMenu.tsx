import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Bookmark, Check, Image, Info, Sparkles } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { GameIcon } from "@/components/game/GameIcon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface CommandZoneCardMenuActions {
  commanderLabel: string;
  customTags: string[];
  appliedTags: string[];
  isFoil: boolean;
  isCover: boolean;
  isCoverBack: boolean;
  hasBackFace: boolean;
  onShowInfo: () => void;
  onRemoveCommander: () => void;
  onPickPrint: () => void;
  onToggleFoil: () => void;
  onSetCover: () => void;
  onSetCoverBack: () => void;
  onApplyTag: (tag: string) => void;
  onCreateTag: (tag: string) => void;
}

export function CommandZoneCardMenu({
  children,
  actions,
}: {
  children: ReactNode;
  actions: CommandZoneCardMenuActions;
}) {
  const [newTag, setNewTag] = useState("");
  const createTag = () => {
    const tag = newTag.trim();
    if (!tag) return;
    actions.onCreateTag(tag);
    setNewTag("");
  };
  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      createTag();
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={actions.onShowInfo}>
          <Info className="mr-2 h-3.5 w-3.5" /> Card info
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={actions.onRemoveCommander}>
          <GameIcon name="crown" className="mr-2 h-3.5 w-3.5" /> Remove {actions.commanderLabel}
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.onSetCover}>
          <GameIcon name="book-cover" className="mr-2 h-3.5 w-3.5" />
          {actions.isCover ? "Remove deck cover" : "Set as deck cover"}
        </ContextMenuItem>
        {actions.hasBackFace && (
          <ContextMenuItem onSelect={actions.onSetCoverBack}>
            <GameIcon
              name="book-cover"
              className="mr-2 h-3.5 w-3.5"
              style={{ transform: "scaleX(-1)" }}
            />
            {actions.isCoverBack ? "Remove back face cover" : "Set back face as cover"}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Bookmark className="mr-2 h-3.5 w-3.5" /> Tags
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            {actions.customTags.map((tag) => (
              <ContextMenuItem key={tag} onSelect={() => actions.onApplyTag(tag)}>
                <Bookmark className="mr-2 h-3.5 w-3.5 text-primary/60" />
                <span className="flex-1 truncate">{tag}</span>
                {actions.appliedTags.includes(tag) && (
                  <Check className="h-3.5 w-3.5 text-primary" />
                )}
              </ContextMenuItem>
            ))}
            {actions.customTags.length > 0 && <ContextMenuSeparator />}
            <div className="p-1" onKeyDown={(event) => event.stopPropagation()}>
              <Input
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="New tag…"
                className="h-7 text-xs"
              />
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={actions.onPickPrint}>
          <Image className="mr-2 h-3.5 w-3.5" /> Choose printing…
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.onToggleFoil}>
          <Sparkles className={cn("mr-2 h-3.5 w-3.5", actions.isFoil && "text-yellow-300")} />
          {actions.isFoil ? "Remove foil" : "Make foil"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

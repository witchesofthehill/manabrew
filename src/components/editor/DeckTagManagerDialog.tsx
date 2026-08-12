import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDeckStore } from "@/stores/useDeckStore";
import { executeDeckEdit } from "./deckEditor.history";

const EMPTY_TAGS: string[] = [];

function TagRow({ tag, first, last }: { tag: string; first: boolean; last: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag);
  const renameCustomTag = useDeckStore((state) => state.renameCustomTag);
  const reorderCustomTag = useDeckStore((state) => state.reorderCustomTag);
  const removeCustomTag = useDeckStore((state) => state.removeCustomTag);

  function finishRename() {
    const nextName = name.trim();
    const duplicate = (useDeckStore.getState().currentDeck.customTags ?? []).some(
      (candidate) => candidate !== tag && candidate.toLowerCase() === nextName.toLowerCase(),
    );
    if (duplicate) {
      setName(tag);
      setEditing(false);
      toast.error(`A tag named "${nextName}" already exists`);
      return;
    }
    if (nextName && nextName !== tag) {
      executeDeckEdit(`Rename ${tag} to ${nextName}`, () => renameCustomTag(tag, nextName));
    }
    setEditing(false);
  }

  return (
    <div className="flex min-h-10 items-center gap-1 rounded-md border px-2">
      {editing ? (
        <Input
          autoFocus
          value={name}
          className="h-8 flex-1"
          onChange={(event) => setName(event.target.value)}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setName(tag);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span className="flex-1 truncate text-sm">{tag}</span>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        disabled={first}
        title={`Move ${tag} up`}
        onClick={() => executeDeckEdit(`Move ${tag} up`, () => reorderCustomTag(tag, -1))}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        disabled={last}
        title={`Move ${tag} down`}
        onClick={() => executeDeckEdit(`Move ${tag} down`, () => reorderCustomTag(tag, 1))}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        title={editing ? "Finish renaming" : `Rename ${tag}`}
        onClick={() => (editing ? finishRename() : setEditing(true))}
      >
        {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-destructive"
        title={`Delete ${tag}`}
        onClick={() => executeDeckEdit(`Delete ${tag}`, () => removeCustomTag(tag))}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function DeckTagManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const storedTags = useDeckStore((state) => state.currentDeck.customTags);
  const tags = storedTags ?? EMPTY_TAGS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage deck tags</DialogTitle>
          <DialogDescription>
            Rename and order the roles used to organize this deck.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {tags.map((tag, index) => (
            <TagRow key={tag} tag={tag} first={index === 0} last={index === tags.length - 1} />
          ))}
          {tags.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Select cards and press T to create the first tag.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

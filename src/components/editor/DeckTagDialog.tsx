import { useMemo, useState } from "react";
import { Check, Plus, Tag } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface DeckTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: string[];
  selectedCount: number;
  onApply: (tag: string) => void;
  onCreateAndApply: (tag: string) => void;
}

export function DeckTagDialog({
  open,
  onOpenChange,
  tags,
  selectedCount,
  onApply,
  onCreateAndApply,
}: DeckTagDialogProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => tags.filter((tag) => tag.toLowerCase().includes(query.trim().toLowerCase())),
    [query, tags],
  );
  const exactMatch = tags.some((tag) => tag.toLowerCase() === query.trim().toLowerCase());

  function apply(tag: string) {
    onApply(tag);
    setQuery("");
    onOpenChange(false);
  }

  function createAndApply() {
    const tag = query.trim();
    if (!tag) return;
    onCreateAndApply(tag);
    setQuery("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm gap-3">
        <DialogHeader>
          <DialogTitle>Tag selected cards</DialogTitle>
          <DialogDescription>
            Apply a role or custom group to {selectedCount} selected card
            {selectedCount === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Tag className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            className="pl-9"
            placeholder="Ramp, removal, combo…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              if (filtered[0]) apply(filtered[0]);
              else createAndApply();
            }}
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.map((tag) => (
            <button
              key={tag}
              type="button"
              className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-muted"
              onClick={() => apply(tag)}
            >
              <Check className="mr-2 h-3.5 w-3.5 text-primary" />
              {tag}
            </button>
          ))}
          {query.trim() && !exactMatch && (
            <Button variant="ghost" className="w-full justify-start" onClick={createAndApply}>
              <Plus className="mr-2 h-3.5 w-3.5" /> Create “{query.trim()}”
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DeckEditorCommand } from "./deckEditor.commands";

interface DeckCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: DeckEditorCommand[];
}

export function DeckCommandPalette({ open, onOpenChange, commands }: DeckCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return commands;
    return commands.filter((command) => {
      const haystack = [command.label, ...(command.keywords ?? [])].join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [commands, query]);

  function run(command: DeckEditorCommand) {
    if (command.disabled) return;
    command.run();
    setQuery("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          setActiveIndex(0);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg gap-2 p-3">
        <DialogHeader className="sr-only">
          <DialogTitle>Deck commands</DialogTitle>
          <DialogDescription>Search for an action to run in the deck editor.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            className="h-11 pl-9"
            placeholder="Type a deck command…"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (
                event.key === "Enter" &&
                filtered[activeIndex] &&
                !filtered[activeIndex].disabled
              ) {
                run(filtered[activeIndex]);
              }
            }}
          />
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length > 0 ? (
            filtered.map((command, index) => (
              <button
                key={command.id}
                type="button"
                disabled={command.disabled}
                className={cn(
                  "flex min-h-10 w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  activeIndex === index && "bg-muted",
                  command.disabled && "cursor-not-allowed opacity-50",
                )}
                title={command.disabledReason}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => run(command)}
              >
                <span>{command.label}</span>
                {command.disabledReason && (
                  <span className="ml-4 text-xs text-muted-foreground">
                    {command.disabledReason}
                  </span>
                )}
              </button>
            ))
          ) : (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matching commands
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

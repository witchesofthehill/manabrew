import { useState } from "react";
import { ArrowLeft, Check, ChevronDown, ImagePlus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScryfallImg } from "@/components/ScryfallImg";
import { FormatBadge } from "@/components/game/FormatBadge";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { GAME_FORMATS, getFormat } from "@/lib/formats";
import { useDeckStore } from "@/stores/useDeckStore";
import { PlaymatEditorModal } from "./PlaymatEditorModal";
import { cn } from "@/lib/utils";
import type { DeckFormat } from "@/protocol/deck";

export function DeckHero({ onBack }: { onBack?: () => void }) {
  const currentDeck = useDeckStore((s) => s.currentDeck);
  const isReadOnly = useDeckStore((s) => s.isReadOnly);
  const setDeckName = useDeckStore((s) => s.setDeckName);
  const setDeckFormat = useDeckStore((s) => s.setDeckFormat);
  const setPlaymat = useDeckStore((s) => s.setPlaymat);
  const setPlaymatSettings = useDeckStore((s) => s.setPlaymatSettings);

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(currentDeck.name);
  const [editorOpen, setEditorOpen] = useState(false);

  const playmat = currentDeck.playmat;
  const playmatColor = currentDeck.playmatSettings?.color;
  const coverArt = resolveCoverCard(currentDeck)?.uris?.art_crop;

  const commanders = currentDeck.commanders ?? [];
  const mainCount = currentDeck.cards.length + commanders.length;
  const sideCount = currentDeck.sideboard.length;
  const maybeCount = currentDeck.maybeboard?.length ?? 0;

  function confirmName() {
    if (nameInput.trim()) setDeckName(nameInput.trim());
    setEditingName(false);
  }

  return (
    <div className="relative isolate overflow-hidden border-b">
      {coverArt && (
        <ScryfallImg
          src={coverArt}
          alt=""
          aria-hidden
          draggable={false}
          loading="lazy"
          className="pointer-events-none absolute inset-0 -z-20 size-full select-none object-cover object-[center_30%]"
        />
      )}
      <div
        className={cn(
          "absolute inset-0 -z-10",
          coverArt
            ? "bg-gradient-to-t from-background via-background/70 to-background/20"
            : "bg-muted/20",
        )}
      />

      {onBack && (
        <button
          type="button"
          className="absolute left-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background/60 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-background/80 hover:text-foreground"
          title="Back to My Decks"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}

      {!isReadOnly && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <button
            type="button"
            title="Customize playmat"
            onClick={() => setEditorOpen(true)}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-md border bg-background/60 text-xs font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:bg-background/80 hover:text-foreground",
              playmat || playmatColor ? "p-1 pr-2.5" : "px-2.5",
            )}
          >
            {playmat ? (
              <img src={playmat} alt="Deck playmat" className="h-6 w-10 rounded object-cover" />
            ) : playmatColor ? (
              <span
                className="h-6 w-10 rounded border"
                style={{ backgroundColor: playmatColor }}
                aria-hidden
              />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            <span>{playmat || playmatColor ? "Edit playmat" : "Playmat"}</span>
          </button>
        </div>
      )}

      {editorOpen && (
        <PlaymatEditorModal
          onClose={() => setEditorOpen(false)}
          playmat={playmat}
          storedSettings={currentDeck.playmatSettings}
          setPlaymat={setPlaymat}
          setPlaymatSettings={setPlaymatSettings}
        />
      )}

      <div className={cn("relative flex flex-col gap-1.5 px-5 pb-4", onBack ? "pt-16" : "pt-10")}>
        <div className="flex flex-wrap items-center gap-1.5">
          {isReadOnly ? (
            <FormatBadge formatId={currentDeck.format ?? "standard"} />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-background/60 px-2 py-0.5 text-xs backdrop-blur-sm transition-colors hover:bg-background/80"
                  title="Change format"
                >
                  <FormatBadge formatId={currentDeck.format ?? "standard"} />
                  <span className="font-medium">
                    {getFormat(currentDeck.format ?? "standard")?.name}
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {GAME_FORMATS.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onSelect={() => setDeckFormat(f.id as DeckFormat)}
                    className="gap-2"
                  >
                    <FormatBadge formatId={f.id} />
                    <span className="text-xs">{f.name}</span>
                    {(currentDeck.format ?? "standard") === f.id && (
                      <Check className="h-3 w-3 ml-auto text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {(currentDeck.labels ?? []).map((label) => (
            <DeckLabelBadge key={label.name} label={label} size="md" />
          ))}
        </div>

        {isReadOnly ? (
          <h1 className="text-2xl font-bold tracking-tight">{currentDeck.name}</h1>
        ) : editingName ? (
          <div className="flex items-center gap-1.5">
            <Input
              className="h-10 w-80 max-w-full !text-xl font-bold"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmName();
                if (e.key === "Escape") {
                  setEditingName(false);
                  setNameInput(currentDeck.name);
                }
              }}
              autoFocus
            />
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={confirmName}>
              <Check className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="group -ml-1.5 flex w-fit max-w-full items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-background/50"
            title="Rename deck"
            onClick={() => {
              setNameInput(currentDeck.name);
              setEditingName(true);
            }}
          >
            <h1 className="truncate text-2xl font-bold tracking-tight">{currentDeck.name}</h1>
            <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {commanders.length > 0 && (
            <span className="truncate font-medium text-foreground/80">
              {commanders.map((c) => c.identity.name).join(" · ")}
            </span>
          )}
          <span className="rounded-full border bg-background/60 px-2 py-0.5 backdrop-blur-sm">
            {mainCount} card{mainCount !== 1 ? "s" : ""}
          </span>
          {sideCount > 0 && (
            <span className="rounded-full border bg-background/60 px-2 py-0.5 backdrop-blur-sm">
              {sideCount} sideboard
            </span>
          )}
          {maybeCount > 0 && (
            <span className="rounded-full border bg-background/60 px-2 py-0.5 backdrop-blur-sm">
              {maybeCount} maybeboard
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

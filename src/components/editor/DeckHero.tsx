import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormatDropdown } from "@/components/FormatDropdown";
import { ScryfallImg } from "@/components/ScryfallImg";
import { FormatBadge } from "@/components/game/FormatBadge";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { GAME_FORMATS, getFormat } from "@/lib/formats";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/useDeckStore";
import { PlaymatEditorModal } from "./PlaymatEditorModal";
import type { DeckFormat } from "@/protocol/deck";

const EDITABLE_FORMATS = GAME_FORMATS.filter((format) => !format.deckFormat);

export function DeckHero({
  children,
  onNameCommit,
  saveStatus,
  renderActions,
}: {
  children: ReactNode;
  onNameCommit: (name: string) => void;
  saveStatus?: string;
  renderActions: (onEditPlaymat: () => void) => ReactNode;
}) {
  const currentDeck = useDeckStore((state) => state.currentDeck);
  const isReadOnly = useDeckStore((state) => state.isReadOnly);
  const setDeckFormat = useDeckStore((state) => state.setDeckFormat);
  const setPlaymat = useDeckStore((state) => state.setPlaymat);
  const setPlaymatSettings = useDeckStore((state) => state.setPlaymatSettings);
  const [draftName, setDraftName] = useState<string | null>(null);
  const [playmatOpen, setPlaymatOpen] = useState(false);
  const coverArt = resolveCoverCard(currentDeck)?.uris?.art_crop;
  const formatId = currentDeck.format ?? "standard";
  const format = getFormat(formatId);
  const size = format?.deckRules.minDeckSize;
  const cardCount = currentDeck.cards.length + (currentDeck.commanders?.length ?? 0);
  const sideCount = currentDeck.sideboard.length;
  const maybeCount = currentDeck.maybeboard?.length ?? 0;

  function commitName() {
    const name = draftName?.trim();
    setDraftName(null);
    if (name && name !== currentDeck.name) {
      useDeckStore.getState().setDeckName(name);
      onNameCommit(name);
    }
  }

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2.5 bg-card px-3 pb-3 pt-2.5 @lg:px-4 @5xl:grid @5xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,max-content)]">
      {coverArt && (
        <ScryfallImg
          src={coverArt}
          alt=""
          draggable={false}
          className={cn(
            "hidden size-14 shrink-0 rounded-md border object-cover object-center @lg:block @5xl:col-start-1 @5xl:row-start-1 @5xl:h-28 @5xl:w-26 @5xl:self-start",
            !isReadOnly && "@5xl:row-span-2",
          )}
        />
      )}
      <div
        className={cn(
          "min-w-0 flex-1 @5xl:row-start-1",
          coverArt ? "@5xl:col-start-2" : "@5xl:col-span-2 @5xl:col-start-1",
        )}
      >
        {isReadOnly ? (
          <h1 className="truncate font-serif text-xl font-bold @lg:text-2xl @5xl:text-3xl">
            {currentDeck.name}
          </h1>
        ) : draftName !== null ? (
          <Input
            autoFocus
            aria-label="Deck name"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setDraftName(null);
            }}
            className="min-h-8 w-full font-serif font-bold @lg:text-xl @5xl:text-2xl"
          />
        ) : (
          <h1 className="min-w-0 font-serif text-xl font-bold leading-tight @lg:text-2xl @5xl:text-3xl">
            <button
              type="button"
              title="Rename deck"
              className="-ml-1 flex min-h-8 w-fit max-w-full items-center gap-2 rounded px-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring touch:min-h-11 touch:min-w-11"
              onClick={() => setDraftName(currentDeck.name)}
            >
              <span className="truncate">{currentDeck.name}</span>
              <Pencil className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </h1>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-meta text-muted-foreground">
          {isReadOnly ? (
            <FormatBadge formatId={formatId} />
          ) : (
            <FormatDropdown
              value={formatId}
              formats={EDITABLE_FORMATS}
              onValueChange={(id) => setDeckFormat(id as DeckFormat)}
            >
              <button
                type="button"
                aria-label={`Change format: ${format?.name ?? formatId}`}
                title="Change format"
                className="-ml-1 inline-flex min-h-6 items-center gap-1 rounded px-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring touch:min-h-11 touch:min-w-11"
              >
                <FormatBadge formatId={formatId} />
                <ChevronDown className="size-3" />
              </button>
            </FormatDropdown>
          )}
          <span className="whitespace-nowrap tabular-nums">
            {size ? `${cardCount} / ${size}` : cardCount} cards
          </span>
          {sideCount > 0 && <span className="hidden @xl:inline">{sideCount} sideboard</span>}
          {maybeCount > 0 && <span className="hidden @xl:inline">{maybeCount} maybeboard</span>}
          {saveStatus && <span role="status">{saveStatus}</span>}
          {(currentDeck.labels ?? []).map((label) => (
            <span key={label.name} className="hidden @xl:inline">
              <DeckLabelBadge label={label} size="md" />
            </span>
          ))}
        </div>
      </div>
      {renderActions(() => setPlaymatOpen(true))}
      {children}
      {playmatOpen && (
        <PlaymatEditorModal
          onClose={() => setPlaymatOpen(false)}
          playmat={currentDeck.playmatUrl}
          storedSettings={currentDeck.playmatSettings}
          playmatAssetId={currentDeck.playmatAssetId}
          setPlaymat={setPlaymat}
          setPlaymatSettings={setPlaymatSettings}
        />
      )}
    </header>
  );
}

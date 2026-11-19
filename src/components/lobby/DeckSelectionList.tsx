import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DeckSelectionCard } from "./DeckSelectionCard";
import { GAME_FORMATS, validateDeckSections } from "@/lib/formats";
import { cn } from "@/lib/utils";
import type { DeckSelectionModel } from "./useDeckSelection";

export function DeckSelectionList({ model }: { model: DeckSelectionModel }) {
  const {
    selectedFormat,
    selectedDeck,
    deckSearch,
    setDeckSearch,
    denseDecks,
    isTouch,
    hubDecks,
    hubSearchResults,
    loadedHubDecks,
    loadingHubDeckId,
    previousDeckEntry,
    filteredUserDecks,
    filteredPresetEntries,
    searchLower,
    cardPool,
    userDeckValidationInput,
    hubDeckValidationInput,
    selectDeck,
    selectHubDeck,
    handleCreate,
    disabled,
  } = model;
  const previousDeckValidation = previousDeckEntry
    ? validateDeckSections(userDeckValidationInput(previousDeckEntry), selectedFormat, cardPool)
    : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 bg-background px-4 pb-2 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            aria-label={`Filter decks`}
            placeholder={`Filter decks...`}
            value={deckSearch}
            onChange={(e) => setDeckSearch(e.target.value)}
            className="min-h-9 w-full rounded-md border bg-background pl-9 pr-3 text-ui-input focus:outline-none focus:ring-1 focus:ring-primary touch:min-h-11 touch:min-w-11"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {previousDeckEntry && previousDeckValidation && (
          <div className="p-4 pb-0 pt-2">
            <SectionLabel>Assigned deck</SectionLabel>
            <div className="mt-3 grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
              <DeckSelectionCard
                name={previousDeckEntry.name}
                badge={previousDeckEntry.badge}
                labels={previousDeckEntry.labels}
                cards={previousDeckEntry.cards}
                cover={previousDeckEntry.cover}
                isPreset={previousDeckEntry.isPreset}
                isSelected={selectedDeck === previousDeckEntry.id}
                isLegal={previousDeckValidation.legal}
                validationError={previousDeckValidation.errors[0]}
                dense={denseDecks}
                isTouch={isTouch}
                disabled={disabled}
                onSelect={() => selectDeck(previousDeckEntry.id)}
                onActivate={() =>
                  void handleCreate(previousDeckEntry, previousDeckEntry.commanderName)
                }
              />
            </div>
          </div>
        )}
        <div className="p-4 pt-2">
          <SectionLabel>My decks</SectionLabel>
          <p className="text-ui-meta text-muted-foreground mt-0.5 mb-3">
            Decks you've built in the editor.
          </p>
          {filteredUserDecks.length === 0 ? (
            <p className="text-ui-meta text-muted-foreground italic">
              {searchLower
                ? `No saved decks match your search.`
                : `No saved decks. Build one in the Deck Editor.`}
            </p>
          ) : (
            <div
              className={cn(
                "grid gap-3",
                "grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]",
              )}
            >
              {filteredUserDecks.map((d) => {
                const validation = validateDeckSections(
                  userDeckValidationInput(d),
                  selectedFormat,
                  cardPool,
                );
                return (
                  <DeckSelectionCard
                    key={d.id}
                    name={d.name}
                    badge={d.badge}
                    labels={d.labels}
                    cards={d.cards}
                    cover={d.cover}
                    isPreset={d.isPreset}
                    isSelected={selectedDeck === d.id}
                    isLegal={validation.legal}
                    validationError={validation.errors[0]}
                    dense={denseDecks}
                    isTouch={isTouch}
                    disabled={disabled}
                    onSelect={() => selectDeck(d.id)}
                    onActivate={() => void handleCreate(d, d.commanderName)}
                  />
                );
              })}
            </div>
          )}
        </div>
        <div className="mx-4 border-t" />

        {hubDecks.enabled &&
          (deckSearch.trim() !== "" ||
            hubDecks.loading ||
            hubDecks.error !== null ||
            hubSearchResults.length > 0) && (
            <div className="p-4">
              <SectionLabel>Community</SectionLabel>
              <p className="text-ui-meta text-muted-foreground mt-0.5 mb-3">
                Community decks are downloaded when selected.
              </p>
              {hubDecks.error ? (
                <div className="flex flex-wrap items-center gap-2 text-ui-meta text-destructive">
                  <span className="min-w-0 break-words">{hubDecks.error}</span>
                  <Button variant="outline" size="sm" onClick={hubDecks.retry}>
                    Retry
                  </Button>
                </div>
              ) : hubDecks.loading && hubSearchResults.length === 0 ? (
                <div
                  className={cn(
                    "grid gap-3",
                    "grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]",
                  )}
                >
                  {Array.from({ length: 10 }, (_, index) => (
                    <div
                      key={index}
                      className={cn(
                        "animate-pulse rounded-lg bg-muted",
                        denseDecks ? "h-24" : "aspect-[4/3] sm:min-h-[172px]",
                      )}
                    />
                  ))}
                </div>
              ) : hubSearchResults.length === 0 ? (
                <p className="text-ui-meta text-muted-foreground italic">
                  No Community decks match your search.
                </p>
              ) : (
                <div
                  className={cn(
                    "grid gap-3",
                    "grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]",
                  )}
                >
                  {hubSearchResults.map((deck) => {
                    const loaded = loadedHubDecks[deck.id];
                    const format = loaded
                      ? GAME_FORMATS.find((item) => item.id === selectedFormat.id)
                      : null;
                    const validation =
                      loaded && format
                        ? validateDeckSections(
                            hubDeckValidationInput(loaded.deck),
                            format,
                            cardPool,
                          )
                        : { legal: true, errors: [] as string[] };
                    return (
                      <DeckSelectionCard
                        key={deck.id}
                        name={loadingHubDeckId === deck.id ? `Loading ${deck.title}…` : deck.title}
                        color={deck.colors}
                        author={deck.author}
                        cardCount={deck.cardCount + deck.commanders.length}
                        badge="Community"
                        cards={[]}
                        cover={undefined}
                        coverImageUrl={deck.coverImageUrl}
                        isPreset={false}
                        isHub
                        isSelected={selectedDeck === `hub:${deck.id}`}
                        isLegal={validation.legal}
                        validationError={validation.errors[0]}
                        dense={denseDecks}
                        isTouch={isTouch}
                        disabled={disabled}
                        loading={loadingHubDeckId === deck.id}
                        onSelect={() => void selectHubDeck(deck)}
                        onActivate={() => void selectHubDeck(deck, true)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

        <div className="mx-4 border-t" />
        <div className="p-4">
          <SectionLabel>Presets</SectionLabel>
          <p className="text-ui-meta text-muted-foreground mt-0.5 mb-3">
            Pre-built themed decks — always legal, great for testing mechanics.
          </p>
          {filteredPresetEntries.length === 0 ? (
            <p className="text-ui-meta text-muted-foreground italic">
              No preset decks match your search.
            </p>
          ) : (
            <div
              className={cn(
                "grid gap-3",
                "grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]",
              )}
            >
              {filteredPresetEntries.map((deck) => (
                <DeckSelectionCard
                  key={deck.id}
                  name={deck.name}
                  desc={deck.desc}
                  color={deck.color}
                  cards={deck.cards}
                  cover={deck.cover}
                  isPreset={deck.isPreset}
                  isSelected={selectedDeck === deck.id}
                  isLegal={true}
                  dense={denseDecks}
                  isTouch={isTouch}
                  disabled={disabled}
                  onSelect={() => selectDeck(deck.id)}
                  onActivate={() => void handleCreate(deck, deck.commanderName)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-ui-label uppercase tracking-wider text-muted-foreground font-semibold">
      {children}
    </Label>
  );
}

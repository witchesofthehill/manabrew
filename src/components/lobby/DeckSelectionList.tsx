import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DeckPickerList } from "./DeckPickerList";
import { DeckSelectionCard } from "./DeckSelectionCard";
import { SavedDeckPickerSection } from "./SavedDeckPickerSection";
import { cn } from "@/lib/utils";
import type { DeckSelectionModel } from "./useDeckSelection";

export function DeckSelectionList({ model }: { model: DeckSelectionModel }) {
  const {
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
    validateDeck,
    validateHubDeck,
    selectDeck,
    selectHubDeck,
    handleCreate,
    disabled,
  } = model;
  const previousDeckValidation = previousDeckEntry ? validateDeck(previousDeckEntry) : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DeckPickerList search={deckSearch} onSearchChange={setDeckSearch}>
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
        <SavedDeckPickerSection
          emptyMessage={
            filteredUserDecks.length
              ? undefined
              : searchLower
                ? "No saved decks match your search."
                : "No saved decks. Build one in the Deck Editor."
          }
        >
          {filteredUserDecks.map((d) => {
            const validation = validateDeck(d);
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
        </SavedDeckPickerSection>
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
                    const validation = loaded
                      ? validateHubDeck(loaded.deck)
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
              {filteredPresetEntries.map((deck) => {
                const validation = validateDeck(deck);
                return (
                  <DeckSelectionCard
                    key={deck.id}
                    name={deck.name}
                    desc={deck.desc}
                    color={deck.color}
                    cards={deck.cards}
                    cover={deck.cover}
                    isPreset={deck.isPreset}
                    isSelected={selectedDeck === deck.id}
                    isLegal={validation.legal}
                    validationError={validation.errors[0]}
                    dense={denseDecks}
                    isTouch={isTouch}
                    disabled={disabled}
                    onSelect={() => selectDeck(deck.id)}
                    onActivate={() => void handleCreate(deck, deck.commanderName)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </DeckPickerList>
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

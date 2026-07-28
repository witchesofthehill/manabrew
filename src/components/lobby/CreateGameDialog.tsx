import { useState, useEffect, useRef } from "react";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useDeckStore } from "@/stores/useDeckStore";
import type { Deck, DeckCard } from "@/protocol/deck";
import {
  GAME_FORMATS,
  validateDeckSections,
  commanderPairLabel,
  type GameFormat,
} from "@/lib/formats";
import { PartnerBadge } from "@/components/deck/PartnerBadge";
import { FormatBadge } from "@/components/game/FormatBadge";
import { DeckSelectionCard } from "./DeckSelectionCard";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { cn } from "@/lib/utils";
import { Search, Shuffle, Swords } from "lucide-react";
import { getDeckFingerprint } from "@/lib/decks";
import { useHubDeckSearch } from "@/hooks/useHubDeckSearch";
import { useHubStore } from "@/stores/useHubStore";
import type { HubDeckDetail, HubDeckSummary } from "@/api/hubTypes";

interface CreateGameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "play" | "lobby";
  forcedFormatId?: string;
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  target?: "player" | "bot";
  onStart: (deck: Deck, formatId: string, commanderName?: string, playerCount?: number) => void;
}

export function CreateGameDialog({
  open,
  onOpenChange,
  mode = "play",
  forcedFormatId,
  preSelectedDeckId,
  preSelectedHubDeckId,
  target = "player",
  onStart,
}: CreateGameDialogProps) {
  const { savedDecks, currentDeck } = useDeckStore();
  const isLobbyMode = mode === "lobby";
  const denseDecks = useIsShortScreen();
  const isTouch = useIsTouch();

  const initialFormat = GAME_FORMATS.find((f) => f.id === forcedFormatId) ?? GAME_FORMATS[0];
  const [selectedFormat, setSelectedFormat] = useState<GameFormat>(initialFormat);
  const [selectedDeck, setSelectedDeck] = useState<string>(preSelectedDeckId ?? "current");
  const [selectedCommander, setSelectedCommander] = useState<string>(
    currentDeck.commanders?.[0]?.identity.name ?? "",
  );
  const presetDecks = usePresetDecks();
  const [playerCount, setPlayerCount] = useState(2);
  const [deckSearch, setDeckSearch] = useState("");
  const [loadedHubDecks, setLoadedHubDecks] = useState<Record<string, HubDeckDetail>>({});
  const [loadingHubDeckId, setLoadingHubDeckId] = useState<string | null>(null);
  const selectedFormatRef = useRef(selectedFormat);
  selectedFormatRef.current = selectedFormat;
  const hubDecks = useHubDeckSearch(deckSearch, selectedFormat.id, open);
  const loadHubDeck = useHubStore((state) => state.loadDeck);
  const restoredHubDeckRef = useRef<string | null>(null);

  useEffect(() => {
    if (!forcedFormatId) return;
    const forced = GAME_FORMATS.find((f) => f.id === forcedFormatId);
    if (forced) setSelectedFormat(forced);
  }, [forcedFormatId]);

  useEffect(() => {
    if (preSelectedDeckId) setSelectedDeck(preSelectedDeckId);
  }, [preSelectedDeckId]);

  useEffect(() => {
    if (!open || !preSelectedHubDeckId || restoredHubDeckRef.current === preSelectedHubDeckId)
      return;
    restoredHubDeckRef.current = preSelectedHubDeckId;
    setLoadingHubDeckId(preSelectedHubDeckId);
    void loadHubDeck(preSelectedHubDeckId)
      .then((detail) => {
        const formatId = detail.deck.format ?? detail.format ?? "standard";
        if (formatId !== selectedFormat.id) {
          restoredHubDeckRef.current = null;
          toast.error(`"${detail.name}" is not a ${selectedFormat.name} deck`);
          return;
        }
        setLoadedHubDecks((current) => ({ ...current, [detail.id]: detail }));
        setSelectedDeck(`hub:${detail.id}`);
        setDeckSearch(detail.name);
      })
      .catch((err) => {
        restoredHubDeckRef.current = null;
        toast.error(err instanceof Error ? err.message : "Failed to load Deck Hub deck");
      })
      .finally(() => setLoadingHubDeckId(null));
  }, [loadHubDeck, open, preSelectedHubDeckId, selectedFormat.id, selectedFormat.name]);

  const currentDeckFingerprint = getDeckFingerprint(currentDeck);
  const distinctSavedDecks = savedDecks.filter(
    (saved) =>
      saved.id === preSelectedDeckId || getDeckFingerprint(saved.deck) !== currentDeckFingerprint,
  );

  const currentDeckIsPlayable =
    currentDeck.cards.length > 0 || (currentDeck.commanders?.length ?? 0) > 0;
  const allDeckCards = (d: Deck): DeckCard[] => [
    ...d.cards,
    ...d.sideboard,
    ...(d.attractions ?? []),
    ...(d.contraptions ?? []),
    ...(d.schemes ?? []),
    ...(d.planes ?? []),
    ...(d.commanders ?? []),
  ];

  const currentDeckEntry = !currentDeckIsPlayable
    ? []
    : [
        {
          id: "current",
          name: currentDeck.name,
          badge: "editing",
          labels: currentDeck.labels,
          sourceDeck: currentDeck,
          isPreset: false as const,
          cover: resolveCoverCard(currentDeck),
          cards: allDeckCards(currentDeck),
          formatId: currentDeck.format ?? "standard",
          commanderName: currentDeck.commanders?.[0]?.identity.name,
        },
      ];
  const userDecks = [
    ...currentDeckEntry,
    ...distinctSavedDecks.map((s) => ({
      id: s.id,
      name: s.deck.name,
      badge: (s.deck.draft ? "draft" : null) as string | null,
      labels: s.deck.labels,
      sourceDeck: s.deck,
      isPreset: false as const,
      cover: resolveCoverCard(s.deck),
      cards: allDeckCards(s.deck),
      formatId: s.deck.format ?? "standard",
      commanderName: s.deck.commanders?.[0]?.identity.name,
    })),
  ];

  const presetDeckEntries = presetDecks.map((deck) => ({
    id: `preset__${deck.id ?? deck.name}`,
    name: deck.name,
    desc: deck.description,
    color: deck.color,
    sourceDeck: deck,
    isPreset: true as const,
    cover: resolveCoverCard(deck),
    cards: [...deck.cards, ...(deck.commanders ?? [])],
    formatId: deck.format ?? "standard",
    commanderName: deck.commanders?.[0]?.identity.name,
  }));
  const hubDeckEntries = Object.values(loadedHubDecks).map((detail) => ({
    id: `hub:${detail.id}`,
    name: detail.name,
    desc: detail.description,
    color: detail.colors,
    badge: "Deck Hub",
    sourceDeck: detail.deck,
    isPreset: false as const,
    cover: resolveCoverCard(detail.deck),
    cards: allDeckCards(detail.deck),
    formatId: detail.deck.format ?? detail.format ?? "standard",
    commanderName: detail.deck.commanders?.[0]?.identity.name,
  }));

  const allDecks = [...userDecks, ...hubDeckEntries, ...presetDeckEntries];

  const searchLower = deckSearch.toLowerCase();
  const formatPresetEntries = presetDeckEntries.filter((d) => d.formatId === selectedFormat.id);
  const filteredPresetEntries = searchLower
    ? formatPresetEntries.filter(
        (d) =>
          d.name.toLowerCase().includes(searchLower) || d.desc?.toLowerCase().includes(searchLower),
      )
    : formatPresetEntries;
  const formatUserDecks = userDecks.filter((d) => d.formatId === selectedFormat.id);
  const filteredUserDecks = searchLower
    ? formatUserDecks.filter((d) => d.name.toLowerCase().includes(searchLower))
    : formatUserDecks;

  useEffect(() => {
    const entry = allDecks.find((d) => d.id === selectedDeck);
    setSelectedCommander(entry?.commanderName ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeck]);

  const selectedDeckEntry = allDecks.find(
    (d) => d.id === selectedDeck && d.formatId === selectedFormat.id,
  );
  const selectedDeckCommanders = selectedDeckEntry?.sourceDeck.commanders ?? [];
  const selectedPartnerLabel = commanderPairLabel(
    selectedDeckCommanders,
    selectedDeckEntry?.sourceDeck.format,
  );

  const legendaryCreatures = selectedDeckEntry
    ? Array.from(
        new Map([
          ...(selectedDeckEntry.commanderName
            ? [
                [selectedDeckEntry.commanderName, selectedDeckEntry.commanderName] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...selectedDeckEntry.cards
            .filter((c) => c.supertypes?.includes("Legendary") && c.types?.includes("Creature"))
            .map((c) => [c.identity.name, c.identity.name] as [string, string]),
        ]).values(),
      )
    : [];

  const needsCommander = selectedFormat.deckRules.requiresCommander;
  const commanderValid = !needsCommander || selectedCommander !== "";
  const selectedDeckIsVisible =
    [...filteredUserDecks, ...filteredPresetEntries].some((entry) => entry.id === selectedDeck) ||
    hubDecks.decks.some((entry) => `hub:${entry.id}` === selectedDeck) ||
    (selectedDeck.startsWith("hub:") && selectedDeckEntry !== undefined);
  const selectedDeckValidation = selectedDeckEntry
    ? selectedDeckEntry.isPreset
      ? { legal: true, errors: [] as string[] }
      : validateDeckSections(
          {
            deck: selectedDeckEntry.sourceDeck,
            commanderName: selectedCommander || selectedDeckEntry.commanderName,
          },
          selectedFormat,
        )
    : { legal: false, errors: [] as string[] };
  const isReady = selectedDeckIsVisible && selectedDeckValidation.legal && commanderValid;

  async function selectHubDeck(summary: HubDeckSummary, activate = false) {
    if (loadingHubDeckId) return;
    setLoadingHubDeckId(summary.id);
    try {
      const detail = await loadHubDeck(summary.id);
      setLoadedHubDecks((current) => ({ ...current, [detail.id]: detail }));
      const entry = {
        id: `hub:${detail.id}`,
        name: detail.name,
        desc: detail.description,
        color: detail.colors,
        badge: "Deck Hub",
        sourceDeck: detail.deck,
        isPreset: false as const,
        cover: resolveCoverCard(detail.deck),
        cards: allDeckCards(detail.deck),
        formatId: detail.deck.format ?? detail.format ?? "standard",
        commanderName: detail.deck.commanders?.[0]?.identity.name,
      };
      const currentFormat = selectedFormatRef.current;
      if (entry.formatId !== currentFormat.id) {
        toast.error(`"${detail.name}" is not a ${currentFormat.name} deck`);
        return;
      }
      setSelectedDeck(entry.id);
      if (activate) handleCreate(entry, entry.commanderName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load Deck Hub deck");
    } finally {
      setLoadingHubDeckId(null);
    }
  }

  function handleCreate(
    entry: (typeof allDecks)[number] | undefined = selectedDeckIsVisible
      ? selectedDeckEntry
      : undefined,
    commanderOverride?: string,
  ) {
    if (!entry) {
      toast.error("Please select a deck");
      return;
    }
    if (entry.formatId !== selectedFormat.id) {
      toast.error("Please select a deck for this format");
      return;
    }
    if (entry.sourceDeck.cards.length === 0 && (entry.sourceDeck.commanders?.length ?? 0) === 0) {
      toast.error(`"${entry.name}" has no cards`);
      return;
    }
    const commander =
      commanderOverride ?? (needsCommander ? selectedCommander : entry.commanderName);
    const validation = entry.isPreset
      ? { legal: true, errors: [] as string[] }
      : validateDeckSections(
          { deck: entry.sourceDeck, commanderName: commander || entry.commanderName },
          selectedFormat,
        );
    if (!validation.legal) {
      toast.warning(validation.errors[0] ?? "Deck is not legal in this format");
      return;
    }
    if (needsCommander && !(commander || entry.commanderName)) {
      toast.error("Please select a commander");
      return;
    }
    onOpenChange(false);
    onStart(
      entry.sourceDeck,
      selectedFormat.id,
      selectedFormat.deckRules.requiresCommander ? commander || entry.commanderName : undefined,
      playerCount,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(96vw,84rem)] max-w-6xl p-0 gap-0 overflow-hidden grid-rows-[auto_minmax(0,1fr)_auto]"
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const target = e.target as HTMLElement;
          if (
            target.closest(
              "input, button, a, textarea, [contenteditable='true'], [role='combobox'], [role='listbox']",
            )
          )
            return;
          e.preventDefault();
          handleCreate();
        }}
      >
        <div className="px-6 py-4 border-b">
          <DialogTitle className="text-lg font-semibold">
            {target === "bot" ? "Choose Bot Deck" : isLobbyMode ? "Choose Deck" : "New Game"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            {target === "bot"
              ? "Select the deck the AI will play in this lobby."
              : isLobbyMode
                ? "Select the deck you will play in this lobby."
                : "Pick a deck and battle a random AI opponent"}
          </p>
        </div>

        <div className="flex min-h-0 overflow-hidden">
          {!isLobbyMode && (
            <div className="w-48 border-r flex-shrink-0 p-4 space-y-5 overflow-y-auto bg-muted/20">
              <div>
                <SectionLabel>Format</SectionLabel>
                <div className="mt-2 space-y-2">
                  {GAME_FORMATS.map((format) => (
                    <button
                      key={format.id}
                      type="button"
                      onClick={() => setSelectedFormat(format)}
                      className={cn(
                        "w-full rounded-lg border p-2.5 text-left transition-colors",
                        selectedFormat.id === format.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/60",
                      )}
                    >
                      <div className="mb-1">
                        <FormatBadge formatId={format.id} />
                      </div>
                      <p className="font-medium text-xs">{format.name}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                        {format.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel>Rules</SectionLabel>
                <div className="mt-2 space-y-1.5">
                  <RulePill
                    label="Deck"
                    value={
                      selectedFormat.deckRules.minDeckSize +
                      (selectedFormat.deckRules.maxDeckSize
                        ? `–${selectedFormat.deckRules.maxDeckSize}`
                        : "+") +
                      " cards"
                    }
                  />
                  <RulePill
                    label="Copies"
                    value={
                      selectedFormat.deckRules.maxCopies === 1
                        ? "Singleton"
                        : `Max ${selectedFormat.deckRules.maxCopies}`
                    }
                  />
                  <RulePill label="Life" value={`${selectedFormat.deckRules.startingLife}`} />
                </div>
              </div>

              {needsCommander && (
                <div>
                  <SectionLabel>Commander</SectionLabel>
                  <div className="mt-2 space-y-1.5">
                    {selectedPartnerLabel ? (
                      <div className="flex flex-wrap items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 text-xs">
                        <span className="truncate">{selectedDeckCommanders[0].identity.name}</span>
                        <span className="text-muted-foreground">+</span>
                        <span className="truncate">{selectedDeckCommanders[1].identity.name}</span>
                        <PartnerBadge label={selectedPartnerLabel} />
                      </div>
                    ) : (
                      <>
                        {legendaryCreatures.length === 0 && (
                          <p className="text-[10px] text-muted-foreground italic">
                            No legendaries in deck — type a name below.
                          </p>
                        )}
                        {legendaryCreatures.length > 0 ? (
                          <select
                            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs pointer-coarse:text-base"
                            value={selectedCommander}
                            onChange={(event) => setSelectedCommander(event.target.value)}
                          >
                            <option value="">— Choose —</option>
                            {legendaryCreatures.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs pointer-coarse:text-base"
                            placeholder="Card name"
                            value={selectedCommander}
                            onChange={(event) => setSelectedCommander(event.target.value)}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              <div>
                <SectionLabel>
                  Opponents
                  <span className="ml-1 text-[9px] font-mono text-warning bg-warning/10 px-1 rounded">
                    DEV
                  </span>
                </SectionLabel>
                <div className="mt-2 flex gap-1">
                  {[2, 3, 4].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setPlayerCount(count)}
                      className={cn(
                        "flex-1 py-1 rounded border text-xs transition-colors",
                        playerCount === count
                          ? "border-warning bg-warning/10 text-warning font-semibold"
                          : "border-border hover:bg-muted/60",
                      )}
                    >
                      {count - 1}v1
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="px-4 pt-4 pb-2 bg-background">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  aria-label="Filter decks"
                  placeholder="Filter decks..."
                  value={deckSearch}
                  onChange={(e) => setDeckSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-md border bg-background text-sm pointer-coarse:h-10 pointer-coarse:text-base focus:outline-none focus:ring-1 focus:ring-primary"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="p-4 pt-2">
                <SectionLabel>Your Decks</SectionLabel>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                  Decks you've built in the editor.
                </p>
                {filteredUserDecks.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    {searchLower
                      ? "No saved decks match your search."
                      : "No saved decks. Build one in the Deck Editor."}
                  </p>
                ) : (
                  <div
                    className={cn(
                      "grid gap-3",
                      denseDecks
                        ? "grid-cols-2 md:grid-cols-3"
                        : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
                    )}
                  >
                    {filteredUserDecks.map((d) => {
                      const validation = validateDeckSections(
                        {
                          deck: d.sourceDeck,
                          commanderName: selectedFormat.deckRules.requiresCommander
                            ? d.id === selectedDeck
                              ? selectedCommander || d.commanderName
                              : d.commanderName
                            : undefined,
                        },
                        selectedFormat,
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
                          onSelect={() => setSelectedDeck(d.id)}
                          onActivate={() => handleCreate(d, d.commanderName)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mx-4 border-t" />

              {hubDecks.enabled && (
                <div className="p-4">
                  <SectionLabel>Deck Hub</SectionLabel>
                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                    Community decks are downloaded when selected.
                  </p>
                  {hubDecks.error ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                      <span className="min-w-0 break-words">{hubDecks.error}</span>
                      <Button variant="outline" size="sm" onClick={hubDecks.retry}>
                        Retry
                      </Button>
                    </div>
                  ) : hubDecks.loading && hubDecks.decks.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Loading Deck Hub decks…</p>
                  ) : hubDecks.decks.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No Deck Hub decks match your search.
                    </p>
                  ) : (
                    <div
                      className={cn(
                        "grid gap-3",
                        denseDecks
                          ? "grid-cols-2 md:grid-cols-3"
                          : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
                      )}
                    >
                      {hubDecks.decks.map((deck) => {
                        const loaded = loadedHubDecks[deck.id];
                        const format = loaded
                          ? GAME_FORMATS.find((item) => item.id === selectedFormat.id)
                          : null;
                        const validation =
                          loaded && format
                            ? validateDeckSections(
                                {
                                  deck: loaded.deck,
                                  commanderName: loaded.deck.commanders?.[0]?.identity.name,
                                },
                                format,
                              )
                            : { legal: true, errors: [] as string[] };
                        return (
                          <DeckSelectionCard
                            key={deck.id}
                            name={
                              loadingHubDeckId === deck.id ? `Loading ${deck.name}…` : deck.name
                            }
                            color={deck.colors}
                            author={deck.author}
                            cardCount={deck.cardCount + deck.commanders.length}
                            badge="Deck Hub"
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
                            disabled={loadingHubDeckId !== null}
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
                <SectionLabel>Starter Decks</SectionLabel>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                  Pre-built themed decks — always legal, great for testing mechanics.
                </p>
                {filteredPresetEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No preset decks match your search.
                  </p>
                ) : (
                  <div
                    className={cn(
                      "grid gap-3",
                      denseDecks
                        ? "grid-cols-2 md:grid-cols-3"
                        : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
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
                        onSelect={() => setSelectedDeck(deck.id)}
                        onActivate={() => handleCreate(deck, deck.commanderName)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t flex items-center justify-between gap-4 bg-muted/10">
          <div className="flex items-center gap-2 text-sm min-w-0">
            {!isLobbyMode && selectedDeckEntry ? (
              <>
                <span className="text-muted-foreground shrink-0">Playing</span>
                <span className="font-medium truncate">{selectedDeckEntry.name}</span>
                <span className="text-muted-foreground shrink-0">vs</span>
                <span className="inline-flex items-center gap-1 text-muted-foreground shrink-0">
                  <Shuffle className="h-3 w-3" />
                  Random AI
                </span>
              </>
            ) : selectedDeckEntry ? (
              <div className="min-w-0">
                <span className="block truncate text-sm text-muted-foreground">
                  Selected:{" "}
                  <span className="font-medium text-foreground">{selectedDeckEntry.name}</span>
                </span>
                {!selectedDeckValidation.legal && (
                  <span className="block truncate text-xs text-warning">
                    {selectedDeckValidation.errors[0] ??
                      "This deck is not legal in the room format."}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground italic text-xs">No deck selected</span>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => handleCreate()}
              disabled={!isReady}
              className="gap-1.5"
            >
              {!isLobbyMode && <Swords className="h-3.5 w-3.5" />}
              {target === "bot" ? "Add Bot" : isLobbyMode ? "Select Deck" : "Play"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
      {children}
    </Label>
  );
}

function RulePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

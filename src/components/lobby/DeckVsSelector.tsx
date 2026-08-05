import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EngineMark } from "@/components/lobby/EngineMark";
import { DeckSelectionCard } from "./DeckSelectionCard";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { cn, pickRandom } from "@/lib/utils";
import { toast } from "sonner";
import { ROUTES } from "@/lib/constants";
import { resolveAiOpponent } from "@/lib/aiOpponent";
import { getDeckFingerprint } from "@/lib/decks";
import { reportPublishedDeckPlay } from "@/lib/deckPlayEvidence";
import { GAME_FORMATS, getFormat, validateDeckSections } from "@/lib/formats";
import { getPlatform } from "@/platform";
import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
import { resolveOfflineEngine } from "@/lib/offlineEngine";
import { hubEntryEngines, supportsEngine } from "@/lib/engines";
import { savePresetToAccountOnUse } from "@/lib/presetDeckAccount";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { Deck } from "@/protocol/deck";
import { Check, ChevronDown, Loader2, Search, Shuffle, Swords, User, Bot, X } from "lucide-react";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { useHubDeckSearch } from "@/hooks/useHubDeckSearch";
import { useHubStore } from "@/stores/useHubStore";
import type { DeckHubEntrySummary } from "@/api/hubTypes";

interface SelectedDeck {
  id: string;
  sourceId: string;
  name: string;
  desc?: string;
  color?: string;
  sourceDeck: Deck;
  source: "local" | "preset" | "hub";
  formatId?: string;
  commanderName?: string;
  coverCardName?: string;
}

interface DeckVsSelectorProps {
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  onStart: (
    playerDeck: Deck,
    opponentDeck: Deck,
    formatId?: string,
    commanderName?: string,
  ) => Promise<boolean>;
}

type PickingSide = "player" | "opponent" | null;
type PlayFormatId = string;

export function DeckVsSelector({
  preSelectedDeckId,
  preSelectedHubDeckId,
  onStart,
}: DeckVsSelectorProps) {
  const denseDecks = useIsShortScreen();
  const isTouch = useIsTouch();
  const { savedDecks, currentDeck } = useDeckStore();
  const preSelectedSavedDeck = savedDecks.find((saved) => saved.id === preSelectedDeckId);
  const preSelectedFormatId = preSelectedSavedDeck?.deck.format ?? "standard";
  const preSelectedFormat = getFormat(preSelectedFormatId);
  const preSelectedCommanderName = preSelectedSavedDeck?.deck.commanders?.[0]?.identity.name;
  const preSelectedDeckEntry: SelectedDeck | null =
    preSelectedSavedDeck &&
    preSelectedFormat &&
    validateDeckSections(
      { deck: preSelectedSavedDeck.deck, commanderName: preSelectedCommanderName },
      preSelectedFormat,
    ).legal
      ? {
          id: `local:${preSelectedSavedDeck.id}`,
          sourceId: preSelectedSavedDeck.id,
          name: preSelectedSavedDeck.deck.name,
          sourceDeck: preSelectedSavedDeck.deck,
          source: "local" as const,
          formatId: preSelectedFormatId,
          commanderName: preSelectedCommanderName,
        }
      : null;
  const lastOfflineFormatId = usePreferencesStore((state) => state.lastOfflineFormatId);
  const lastAiOpponent = usePreferencesStore((state) => state.lastAiOpponent);
  const lastOfflineEngine = usePreferencesStore((state) => state.lastOfflineEngine);
  const setLastOfflineEngine = usePreferencesStore((state) => state.setLastOfflineEngine);
  const rememberedFormatId =
    !preSelectedDeckEntry && lastOfflineFormatId && getFormat(lastOfflineFormatId)
      ? lastOfflineFormatId
      : null;
  const [playerDeck, setPlayerDeck] = useState<SelectedDeck | null>(preSelectedDeckEntry);
  const [opponentDeck, setOpponentDeck] = useState<SelectedDeck | null>(null);
  const [pickingSide, setPickingSide] = useState<PickingSide>(
    preSelectedDeckEntry ? "opponent" : "player",
  );
  const [selectedFormat, setSelectedFormat] = useState<PlayFormatId | null>(
    preSelectedDeckEntry?.formatId ?? rememberedFormatId,
  );
  const [opponentConfirmed, setOpponentConfirmed] = useState(false);
  const [deckSearch, setDeckSearch] = useState("");
  const [starting, setStarting] = useState(false);
  const [loadingHubDeckId, setLoadingHubDeckId] = useState<string | null>(null);
  const selectedFormatRef = useRef(selectedFormat);
  selectedFormatRef.current = selectedFormat;
  const opponentTouchedRef = useRef(false);
  const isWeb = getPlatform().type === "web";
  const hostedAvailable = isHostedEngineAvailable();
  const offlineEngine = resolveOfflineEngine(lastOfflineEngine);
  const presetDecks = usePresetDecks(offlineEngine);
  const hubDecks = useHubDeckSearch(deckSearch, selectedFormat ?? undefined, true, [offlineEngine]);
  const hubDeckEntries = hubDecks.decks.filter((entry) =>
    supportsEngine(hubEntryEngines(entry), offlineEngine),
  );
  const loadHubDeck = useHubStore((state) => state.loadEntry);
  const restoredHubDeckRef = useRef<string | null>(null);
  const hubSelectionRequestIdRef = useRef(0);
  const [hubRestoreAttempt, setHubRestoreAttempt] = useState(0);

  useEffect(() => {
    if (
      !hubDecks.enabled ||
      !preSelectedHubDeckId ||
      restoredHubDeckRef.current === preSelectedHubDeckId
    )
      return;
    restoredHubDeckRef.current = preSelectedHubDeckId;
    const requestId = ++hubSelectionRequestIdRef.current;
    setLoadingHubDeckId(preSelectedHubDeckId);
    void loadHubDeck(preSelectedHubDeckId)
      .then((detail) => {
        if (hubSelectionRequestIdRef.current !== requestId) return;
        const formatId = detail.deck.format ?? detail.format ?? "standard";
        setPlayerDeck({
          id: `hub:${detail.id}`,
          sourceId: detail.id,
          name: detail.title,
          sourceDeck: detail.deck,
          source: "hub",
          formatId,
          commanderName: detail.deck.commanders?.[0]?.identity.name,
        });
        setSelectedFormat(formatId);
        setPickingSide("opponent");
      })
      .catch((err) => {
        if (hubSelectionRequestIdRef.current !== requestId) return;
        restoredHubDeckRef.current = null;
        toast.error(err instanceof Error ? err.message : "Failed to load Community deck", {
          action: {
            label: "Retry",
            onClick: () => setHubRestoreAttempt((attempt) => attempt + 1),
          },
        });
      })
      .finally(() => {
        if (hubSelectionRequestIdRef.current === requestId) setLoadingHubDeckId(null);
      });
  }, [hubDecks.enabled, hubRestoreAttempt, loadHubDeck, preSelectedHubDeckId]);

  const searchLower = deckSearch.toLowerCase();
  const formatFilteredPresets = presetDecks.filter(
    (deck) => selectedFormat === null || (deck.format ?? "standard") === selectedFormat,
  );
  const filteredDecks = searchLower
    ? formatFilteredPresets.filter(
        (deck) =>
          deck.name.toLowerCase().includes(searchLower) ||
          (deck.description ?? "").toLowerCase().includes(searchLower),
      )
    : formatFilteredPresets;

  const currentDeckFingerprint = getDeckFingerprint(currentDeck);
  const distinctSavedDecks = savedDecks.filter(
    (saved) =>
      saved.id === preSelectedDeckId || getDeckFingerprint(saved.deck) !== currentDeckFingerprint,
  );

  const currentDeckIsPlayable =
    currentDeck.cards.length > 0 || (currentDeck.commanders?.length ?? 0) > 0;

  const userDeckEntries: SelectedDeck[] = [
    ...(currentDeckIsPlayable ? [currentDeck] : []),
    ...distinctSavedDecks.map((saved) => saved.deck),
  ].map((deck, index) => {
    const id =
      currentDeckIsPlayable && index === 0
        ? "current"
        : distinctSavedDecks[currentDeckIsPlayable ? index - 1 : index]!.id;
    return {
      id: `local:${id}`,
      sourceId: id,
      name: deck.name,
      sourceDeck: deck,
      source: "local" as const,
      formatId: deck.format ?? "standard",
      commanderName: deck.commanders?.[0]?.identity.name,
    };
  });

  const deckValidations = useMemo(() => {
    const map = new Map<string, { legal: boolean; errors: string[] }>();
    for (const entry of userDeckEntries) {
      const format = getFormat(entry.formatId ?? "standard");
      if (!format) continue;
      map.set(
        entry.id,
        validateDeckSections(
          { deck: entry.sourceDeck, commanderName: entry.commanderName },
          format,
        ),
      );
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedDecks, currentDeck]);

  const formatFilteredUserDecks = userDeckEntries.filter(
    (deck) => selectedFormat === null || deck.formatId === selectedFormat,
  );
  const filteredUserDecks = searchLower
    ? formatFilteredUserDecks.filter((deck) => deck.name.toLowerCase().includes(searchLower))
    : formatFilteredUserDecks;

  useEffect(() => {
    if (!selectedFormat || opponentDeck || opponentTouchedRef.current) return;
    const resolved = resolveAiOpponent({
      presets: presetDecks,
      savedDecks,
      formatId: selectedFormat,
      last: lastAiOpponent,
    });
    if (!resolved) return;
    const source = resolved.source === "preset" ? "preset" : "local";
    setOpponentDeck({
      id: `${source}:${resolved.id}`,
      sourceId: resolved.id,
      name: resolved.deck.name,
      desc: resolved.deck.description,
      color: resolved.deck.color,
      sourceDeck: resolved.deck,
      source,
      formatId: selectedFormat,
      commanderName: resolved.deck.commanders?.[0]?.identity.name,
      coverCardName: resolved.deck.coverCardName,
    });
  }, [selectedFormat, opponentDeck, presetDecks, savedDecks, lastAiOpponent]);

  function invalidateHubSelection() {
    hubSelectionRequestIdRef.current += 1;
    setLoadingHubDeckId(null);
  }

  function changeFormat(formatId: PlayFormatId | null) {
    if (formatId === selectedFormat) return;
    invalidateHubSelection();
    opponentTouchedRef.current = false;
    setPlayerDeck(null);
    setOpponentDeck(null);
    setOpponentConfirmed(false);
    setPickingSide("player");
    setSelectedFormat(formatId);
  }

  function assignDeck(selected: SelectedDeck, hubRequestId?: number) {
    if (hubRequestId === undefined) {
      invalidateHubSelection();
    } else if (hubSelectionRequestIdRef.current !== hubRequestId) {
      return;
    }
    if (pickingSide === "player" || pickingSide === null) {
      setPlayerDeck(selected);
      setPickingSide("opponent");
      return;
    }

    if (pickingSide !== "opponent") return;
    opponentTouchedRef.current = true;
    setOpponentDeck(selected);
    setOpponentConfirmed(true);
    setPickingSide(playerDeck ? null : "player");
  }

  function selectDeck(deck: Deck) {
    const formatId = deck.format ?? "standard";
    if (!selectedFormat) setSelectedFormat(formatId);
    const sourceId = deck.id ?? deck.name;
    assignDeck({
      id: `preset:${sourceId}`,
      sourceId,
      name: deck.name,
      desc: deck.description,
      color: deck.color,
      sourceDeck: deck,
      source: "preset",
      formatId,
      commanderName: deck.commanders?.[0]?.identity.name,
      coverCardName: deck.coverCardName,
    });
  }

  async function selectHubDeck(summary: DeckHubEntrySummary) {
    const requestId = ++hubSelectionRequestIdRef.current;
    setLoadingHubDeckId(summary.id);
    try {
      const detail = await loadHubDeck(summary.id);
      if (hubSelectionRequestIdRef.current !== requestId) return;
      const deck = detail.deck;
      const formatId = deck.format ?? summary.format ?? "standard";
      const currentFormat = selectedFormatRef.current;
      if (currentFormat && formatId !== currentFormat) {
        toast.error(
          `"${detail.title}" is not a ${getFormat(currentFormat)?.name ?? currentFormat} deck`,
        );
        return;
      }
      if (!currentFormat) setSelectedFormat(formatId);
      assignDeck(
        {
          id: `hub:${summary.id}`,
          sourceId: summary.id,
          name: deck.name,
          sourceDeck: deck,
          source: "hub",
          formatId,
          commanderName: deck.commanders?.[0]?.identity.name,
        },
        requestId,
      );
    } catch (err) {
      if (hubSelectionRequestIdRef.current !== requestId) return;
      toast.error(err instanceof Error ? err.message : "Failed to load Community deck");
    } finally {
      if (hubSelectionRequestIdRef.current === requestId) setLoadingHubDeckId(null);
    }
  }

  function selectUserDeck(entry: SelectedDeck) {
    if (!selectedFormat && entry.formatId) setSelectedFormat(entry.formatId);
    assignDeck(entry);
  }

  function handleRandomOpponent() {
    if (!selectedFormat) return;
    const random = pickRandom(formatFilteredPresets);
    if (!random) return;
    invalidateHubSelection();
    const sourceId = random.id ?? random.name;
    opponentTouchedRef.current = true;
    setOpponentDeck({
      id: `preset:${sourceId}`,
      sourceId,
      name: random.name,
      desc: random.description,
      color: random.color,
      sourceDeck: random,
      source: "preset",
      formatId: selectedFormat,
      commanderName: random.commanders?.[0]?.identity.name,
      coverCardName: random.coverCardName,
    });
    setOpponentConfirmed(true);
    setPickingSide(playerDeck ? null : "player");
  }

  async function handleFight() {
    if (!playerDeck || !opponentDeck || starting) return;
    const empty = [playerDeck, opponentDeck].find(
      (d) => d.sourceDeck.cards.length === 0 && (d.sourceDeck.commanders?.length ?? 0) === 0,
    );
    if (empty) {
      toast.error(`"${empty.name}" has no cards`);
      return;
    }
    for (const selected of [playerDeck, opponentDeck]) {
      if (selected.source !== "hub") continue;
      const format = getFormat(selected.formatId ?? "standard");
      if (!format) continue;
      const validation = validateDeckSections(
        { deck: selected.sourceDeck, commanderName: selected.commanderName },
        format,
      );
      if (!validation.legal) {
        toast.warning(validation.errors[0] ?? `"${selected.name}" is not legal`);
        return;
      }
    }
    setStarting(true);
    const started = await onStart(
      playerDeck.sourceDeck,
      opponentDeck.sourceDeck,
      playerDeck.formatId,
      playerDeck.commanderName,
    );
    if (!started) {
      setStarting(false);
      return;
    }
    if (playerDeck.source === "hub" || playerDeck.source === "preset") {
      void reportPublishedDeckPlay(playerDeck.sourceId, playerDeck.sourceDeck);
    }
    if (playerDeck.source === "preset") {
      savePresetToAccountOnUse(playerDeck.sourceId);
    }
    const prefs = usePreferencesStore.getState();
    if (playerDeck.formatId) prefs.setLastOfflineFormatId(playerDeck.formatId);
    if (playerDeck.source === "local" && playerDeck.sourceId !== "current") {
      prefs.setLastPlayedDeckId(playerDeck.sourceId);
    }
    if (opponentDeck.source === "preset") {
      prefs.setLastAiOpponent({ kind: "preset", id: opponentDeck.sourceId });
    } else if (opponentDeck.source === "local" && opponentDeck.sourceId !== "current") {
      prefs.setLastAiOpponent({ kind: "saved", id: opponentDeck.sourceId });
    }
  }

  const hubSelectionIsLegal = (selected: SelectedDeck | null) => {
    if (!selected || selected.source !== "hub") return true;
    const format = getFormat(selected.formatId ?? "standard");
    return (
      !format ||
      validateDeckSections(
        { deck: selected.sourceDeck, commanderName: selected.commanderName },
        format,
      ).legal
    );
  };
  const isReady =
    !!playerDeck &&
    !!opponentDeck &&
    opponentConfirmed &&
    hubSelectionIsLegal(playerDeck) &&
    hubSelectionIsLegal(opponentDeck);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-3 border-b bg-muted/5 px-4 py-2 sm:px-6 lg:px-8">
        <div
          role="group"
          aria-label="Filter decks by format"
          className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 py-1 no-scrollbar"
        >
          {[{ id: null, name: "All" }, ...GAME_FORMATS].map((format) => (
            <button
              key={format.id ?? "all"}
              type="button"
              aria-pressed={selectedFormat === format.id}
              onClick={() => changeFormat(format.id)}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none pointer-coarse:min-h-10 pointer-coarse:px-3",
                selectedFormat === format.id
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {format.name}
            </button>
          ))}
        </div>
        <p
          className="hidden shrink-0 text-right text-xs font-medium text-muted-foreground lg:block"
          aria-live="polite"
        >
          {pickingSide === "player"
            ? isReady
              ? "Choose your deck or fight"
              : "Choose your deck"
            : pickingSide === "opponent"
              ? isReady
                ? "Choose the AI deck or fight"
                : "Choose the AI deck"
              : "Matchup ready"}
        </p>
      </div>

      <div className="flex-shrink-0 px-4 pb-2 pt-3 sm:px-6 lg:px-8">
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

      <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-4 sm:px-6 lg:px-8">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold pt-2 pb-1">
            Your Decks
          </p>
          {filteredUserDecks.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">
              No decks yet — build one in{" "}
              <Link
                to={ROUTES.DECK_EDITOR}
                className="text-primary underline-offset-2 hover:underline not-italic"
              >
                My Decks
              </Link>
              .
            </p>
          ) : (
            <div
              className={cn(
                "grid gap-3",
                denseDecks
                  ? "grid-cols-2 md:grid-cols-3"
                  : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
              )}
            >
              {filteredUserDecks.map((entry) => {
                const displayCards = [
                  ...(entry.sourceDeck?.cards ?? []),
                  ...(entry.sourceDeck?.commanders ?? []),
                ];
                const cover = entry.sourceDeck ? resolveCoverCard(entry.sourceDeck) : undefined;
                const validation = deckValidations.get(entry.id) ?? {
                  legal: true,
                  errors: [] as string[],
                };
                return (
                  <DeckSelectionCard
                    key={entry.id}
                    name={entry.name}
                    color={entry.color}
                    badge={entry.sourceDeck?.draft ? "draft" : undefined}
                    cards={displayCards}
                    cover={cover}
                    isLegal={validation.legal}
                    validationError={validation.errors[0]}
                    labels={entry.sourceDeck?.labels}
                    isPreset={false}
                    isSelected={false}
                    isPlayerDeck={playerDeck?.id === entry.id}
                    isOpponentDeck={opponentDeck?.id === entry.id}
                    formatId={entry.sourceDeck?.format ?? entry.formatId ?? "standard"}
                    dense={denseDecks}
                    isTouch={isTouch}
                    onSelect={() => selectUserDeck(entry)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {hubDecks.enabled &&
          (deckSearch.trim() !== "" || hubDecks.error !== null || hubDeckEntries.length > 0) && (
            <div>
              <p className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Community
              </p>
              {hubDecks.error ? (
                <div className="flex flex-wrap items-center gap-2 py-2 text-xs text-destructive">
                  <span className="min-w-0 break-words">{hubDecks.error}</span>
                  <Button variant="outline" size="sm" onClick={hubDecks.retry}>
                    Retry
                  </Button>
                </div>
              ) : hubDecks.loading && hubDeckEntries.length === 0 ? (
                <p className="py-2 text-xs italic text-muted-foreground">
                  Loading Community decks…
                </p>
              ) : hubDeckEntries.length === 0 ? (
                <p className="py-2 text-xs italic text-muted-foreground">
                  No Community decks match this format and search.
                </p>
              ) : (
                <div
                  className={cn(
                    "grid gap-3 pt-1",
                    denseDecks
                      ? "grid-cols-2 md:grid-cols-3"
                      : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
                  )}
                >
                  {hubDeckEntries.map((deck) => {
                    const selected = [playerDeck, opponentDeck].find(
                      (entry) => entry?.source === "hub" && entry.sourceId === deck.id,
                    );
                    const format = selected ? getFormat(selected.formatId ?? "standard") : null;
                    const validation =
                      selected && format
                        ? validateDeckSections(
                            { deck: selected.sourceDeck, commanderName: selected.commanderName },
                            format,
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
                        isSelected={false}
                        isLegal={validation.legal}
                        validationError={validation.errors[0]}
                        isPlayerDeck={playerDeck?.id === `hub:${deck.id}`}
                        isOpponentDeck={opponentDeck?.id === `hub:${deck.id}`}
                        formatId={deck.format ?? "standard"}
                        dense={denseDecks}
                        isTouch={isTouch}
                        loading={loadingHubDeckId === deck.id}
                        onSelect={() => void selectHubDeck(deck)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold pb-1">
            Starter Decks
          </p>
          {filteredDecks.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">
              No starter decks for this format.
            </p>
          ) : (
            <div
              className={cn(
                "grid gap-3 pt-1",
                denseDecks
                  ? "grid-cols-2 md:grid-cols-3"
                  : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
              )}
            >
              {filteredDecks.map((deck) => (
                <DeckSelectionCard
                  key={deck.id ?? deck.name}
                  name={deck.name}
                  desc={deck.description}
                  color={deck.color}
                  cards={deck.cards}
                  cover={resolveCoverCard(deck)}
                  coverFallbackClassName="absolute inset-0 bg-gradient-to-br from-muted-foreground/10 via-muted/40 to-muted-foreground/20"
                  isPreset={true}
                  isSelected={false}
                  isPlayerDeck={playerDeck?.id === `preset:${deck.id ?? deck.name}`}
                  isOpponentDeck={opponentDeck?.id === `preset:${deck.id ?? deck.name}`}
                  formatId={deck.format ?? "standard"}
                  dense={denseDecks}
                  isTouch={isTouch}
                  onSelect={() => selectDeck(deck)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid flex-shrink-0 gap-2 border-t bg-muted/10 px-4 py-2 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:px-6 sm:py-3 lg:px-8">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 sm:flex sm:gap-2">
          <DeckSlot
            label="YOU"
            icon={<User className="h-3 w-3" />}
            deck={playerDeck}
            sideColor="var(--player-colors-self)"
            isActive={pickingSide === "player"}
            isConfirmed={!!playerDeck && pickingSide !== "player"}
            onClick={() => {
              invalidateHubSelection();
              setPickingSide("player");
            }}
            onClear={() => {
              invalidateHubSelection();
              setPlayerDeck(null);
              setPickingSide("player");
            }}
          />
          <span className="text-xs font-bold tracking-wider text-muted-foreground/60">VS</span>
          <DeckSlot
            label="AI"
            icon={<Bot className="h-3 w-3" />}
            deck={opponentDeck}
            sideColor="var(--player-colors-opponent1)"
            isActive={pickingSide === "opponent"}
            isConfirmed={!!opponentDeck && opponentConfirmed && pickingSide !== "opponent"}
            onClick={() => {
              invalidateHubSelection();
              setOpponentConfirmed(false);
              setPickingSide("opponent");
            }}
            onClear={() => {
              invalidateHubSelection();
              opponentTouchedRef.current = true;
              setOpponentDeck(null);
              setOpponentConfirmed(false);
              setPickingSide("opponent");
            }}
            placeholderExtra={
              !opponentDeck && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRandomOpponent();
                  }}
                  className="inline-flex w-8 shrink-0 items-center justify-center gap-0.5 rounded-r-md text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground pointer-coarse:w-10"
                  title="Random AI deck"
                >
                  <Shuffle className="h-3 w-3" />
                </button>
              )
            }
          />
        </div>
        <div className="grid grid-flow-col auto-cols-fr gap-2 sm:flex sm:flex-shrink-0 sm:items-center">
          {isWeb && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="w-full gap-1.5 sm:w-auto">
                  <EngineMark engine={offlineEngine} className="h-3.5 w-3.5" />
                  {offlineEngine}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => setLastOfflineEngine("Forge")}
                  disabled={!hostedAvailable}
                  className="gap-1.5 text-xs"
                >
                  <EngineMark engine="Forge" className="h-3.5 w-3.5" />
                  Forge
                  {hostedAvailable && (
                    <span className="text-[9px] text-muted-foreground">recommended</span>
                  )}
                  {offlineEngine === "Forge" && <Check className="ml-auto h-3 w-3" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setLastOfflineEngine("Manabrew")}
                  className="gap-1.5 text-xs"
                >
                  <EngineMark engine="Manabrew" className="h-3.5 w-3.5" />
                  Manabrew
                  {offlineEngine === "Manabrew" && <Check className="ml-auto h-3 w-3" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            size="sm"
            onClick={handleFight}
            disabled={!isReady || starting}
            aria-busy={starting}
            className="w-full gap-1.5 sm:w-auto"
          >
            {starting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Swords className="h-3.5 w-3.5" />
            )}
            {starting ? "Starting…" : "Fight!"}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface DeckSlotProps {
  label: string;
  icon: ReactNode;
  deck: SelectedDeck | null;
  sideColor: string;
  isActive: boolean;
  isConfirmed: boolean;
  onClick: () => void;
  onClear: () => void;
  placeholderExtra?: ReactNode;
}

function DeckSlot({
  label,
  icon,
  deck,
  sideColor,
  isActive,
  isConfirmed,
  onClick,
  onClear,
  placeholderExtra,
}: DeckSlotProps) {
  return (
    <div
      className={cn(
        "group inline-flex min-h-8 min-w-0 max-w-[14rem] items-stretch rounded-md border text-xs transition-colors pointer-coarse:min-h-10 sm:min-w-24",
        isActive ? "ring-1" : "border-border/40 hover:border-border hover:bg-muted/40",
      )}
      style={{
        borderColor: isActive ? sideColor : undefined,
        boxShadow: isActive
          ? `inset 0 0 0 1px color-mix(in srgb, ${sideColor} 35%, transparent)`
          : undefined,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-l-md px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className="inline-flex shrink-0 items-center gap-0.5 font-bold text-[10px] uppercase tracking-wider"
          style={{ color: sideColor }}
        >
          {icon}
          {label}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            deck ? "font-medium text-foreground/90" : "italic text-muted-foreground",
          )}
        >
          {deck?.name ?? "pick a deck"}
        </span>
        {isActive ? (
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-primary">
            Selecting
          </span>
        ) : isConfirmed ? (
          <Check className="h-3 w-3 shrink-0 text-primary" />
        ) : (
          deck && (
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              Suggested
            </span>
          )
        )}
      </button>
      {deck ? (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex w-8 shrink-0 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-destructive pointer-coarse:w-10"
          title="Clear"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      ) : (
        placeholderExtra
      )}
    </div>
  );
}

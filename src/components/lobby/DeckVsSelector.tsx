import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { FormatBadge } from "@/components/game/FormatBadge";
import { TablePickerDialog } from "@/components/lobby/TablePickerDialog";
import { DeckSelectionCard } from "./DeckSelectionCard";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { useTheme } from "@/hooks/useTheme";
import { cn, pickRandom } from "@/lib/utils";
import { toast } from "sonner";
import { ROUTES } from "@/lib/constants";
import { resolveAiOpponent } from "@/lib/aiOpponent";
import { getDeckFingerprint } from "@/lib/decks";
import { reportPublishedDeckPlay } from "@/lib/deckPlayEvidence";
import { GAME_FORMATS, getFormat, validateDeckSections } from "@/lib/formats";
import { resolveOfflineEngine } from "@/lib/offlineEngine";
import { hubEntryEngines, supportsEngine } from "@/lib/engines";
import { savePresetToAccountOnUse } from "@/lib/presetDeckAccount";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { Deck } from "@/protocol/deck";
import { Loader2, Search, Swords } from "lucide-react";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { useHubDeckSearch } from "@/hooks/useHubDeckSearch";
import { useHubStore } from "@/stores/useHubStore";
import { useCardPool } from "@/hooks/useCardPool";
import type { DeckHubEntrySummary } from "@/api/hubTypes";
import type { DeckAssignment, SelectedDeck } from "./deckSelection.types";
import { OfflineRoster } from "./OfflineRoster";
import {
  createOfflineRoster,
  FIRST_BOT_SEAT_ID,
  offlineRosterReducer,
  PLAYER_SEAT_ID,
} from "./offlineRoster.state";
import {
  isOfflinePodFormat,
  offlineSelectionError,
  prepareOfflineGame,
} from "./offlineRoster.utils";
interface DeckVsSelectorProps {
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  preSelectedDeck?: SelectedDeck;
  leadingControl?: ReactNode;
  spectator?: boolean;
  onSimulate?: (decks: Deck[], formatId: string, games: number) => Promise<boolean>;
  onStart: (
    playerDeck: Deck,
    opponentDecks: Deck[],
    formatId?: string,
    commanderName?: string,
  ) => Promise<boolean>;
}
type PlayFormatId = string;
export function DeckVsSelector({
  preSelectedDeckId,
  preSelectedHubDeckId,
  preSelectedDeck,
  leadingControl,
  spectator = false,
  onSimulate,
  onStart,
}: DeckVsSelectorProps) {
  const denseDecks = useIsShortScreen();
  const isTouch = useIsTouch();
  const shortTouch = isTouch;
  const currentDeck = useDeckStore((state) => state.currentDeck);
  const savedDecks = useOwnedDecks();
  const preSelectedSavedDeck = savedDecks.find((saved) => saved.id === preSelectedDeckId);
  const preSelectedFormatId = preSelectedSavedDeck?.deck.format ?? "standard";
  const preSelectedFormat = getFormat(preSelectedFormatId);
  const preSelectedCommanderName = preSelectedSavedDeck?.deck.commanders?.[0]?.identity.name;
  const preSelectedDeckEntry: SelectedDeck | null =
    preSelectedDeck ??
    (preSelectedSavedDeck && preSelectedFormat
      ? {
          id: `local:${preSelectedSavedDeck.id}`,
          sourceId: preSelectedSavedDeck.id,
          name: preSelectedSavedDeck.deck.name,
          sourceDeck: preSelectedSavedDeck.deck,
          source: "local",
          formatId: preSelectedFormatId,
          commanderName: preSelectedCommanderName,
        }
      : null);
  const lastOfflineFormatId = usePreferencesStore((state) => state.lastOfflineFormatId);
  const lastAiOpponent = usePreferencesStore((state) => state.lastAiOpponent);
  const boardBackground = usePreferencesStore((state) => state.boardBackgroundId);
  const setBoardBackground = usePreferencesStore((state) => state.setBoardBackgroundId);
  const rememberedFormatId =
    !preSelectedDeckEntry && lastOfflineFormatId && getFormat(lastOfflineFormatId)
      ? lastOfflineFormatId
      : null;
  const [roster, dispatchRoster] = useReducer(
    offlineRosterReducer,
    preSelectedDeckEntry,
    createOfflineRoster,
  );
  const theme = useTheme().gameTheme;
  const seatColors = [
    theme.playerColors.self,
    theme.playerColors.opponent1,
    theme.playerColors.opponent2,
    theme.playerColors.opponent3,
  ];
  const opponentDeck = roster.seats[1].deck;
  const suggestedOpponent = roster.seats.find((seat) => seat.id === FIRST_BOT_SEAT_ID);
  const assignments: DeckAssignment[] = roster.seats.map((seat, index) => ({
    id: seat.id,
    label: spectator ? `AI ${index + 1}` : index === 0 ? "You" : `Bot ${index}`,
    color: seatColors[index],
  }));
  const assignmentsForDeck = (id: string) =>
    assignments.filter((_, index) => roster.seats[index].deck?.id === id);
  const [selectedFormat, setSelectedFormat] = useState<PlayFormatId | null>(
    preSelectedDeckEntry?.formatId ?? rememberedFormatId,
  );
  const [deckSearch, setDeckSearch] = useState("");
  const [starting, setStarting] = useState(false);
  const [simulationGames, setSimulationGames] = useState(10);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [loadingHubDeckId, setLoadingHubDeckId] = useState<string | null>(null);
  const [loadingSeatId, setLoadingSeatId] = useState<string | null>(null);
  const selectedFormatRef = useRef(selectedFormat);
  selectedFormatRef.current = selectedFormat;
  const offlineEngine = resolveOfflineEngine();
  const { details: accountDeckDetails } = useAccountDecks();
  const forkedPresetKeys = new Set(
    Object.values(accountDeckDetails)
      .map((detail) => detail.derivedFromPresetKey?.toLowerCase())
      .filter((key): key is string => key !== undefined),
  );
  const presetDecks = usePresetDecks(offlineEngine).filter(
    (preset) => !forkedPresetKeys.has((preset.id ?? "").toLowerCase()),
  );
  const hubDecks = useHubDeckSearch(
    deckSearch,
    selectedFormat ?? undefined,
    true,
    [offlineEngine],
    "community",
  );
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
    setLoadingSeatId(PLAYER_SEAT_ID);
    setLoadingHubDeckId(preSelectedHubDeckId);
    void loadHubDeck(preSelectedHubDeckId)
      .then((detail) => {
        if (hubSelectionRequestIdRef.current !== requestId) return;
        const formatId = detail.deck.format ?? detail.format ?? "standard";
        dispatchRoster({
          type: "assign",
          seatId: PLAYER_SEAT_ID,
          deck: {
            id: `hub:${detail.id}`,
            sourceId: detail.id,
            name: detail.title,
            sourceDeck: detail.deck,
            source: "hub",
            formatId,
            commanderName: detail.deck.commanders?.[0]?.identity.name,
          },
        });
        setSelectedFormat(formatId);
      })
      .catch((err) => {
        if (hubSelectionRequestIdRef.current !== requestId) return;
        restoredHubDeckRef.current = null;
        toast.error(err instanceof Error ? err.message : `Failed to load Community deck`, {
          action: {
            label: `Retry`,
            onClick: () => setHubRestoreAttempt((attempt) => attempt + 1),
          },
        });
      })
      .finally(() => {
        if (hubSelectionRequestIdRef.current === requestId) {
          setLoadingHubDeckId(null);
          setLoadingSeatId(null);
        }
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
  const formatFilteredUserDecks = userDeckEntries.filter(
    (deck) => selectedFormat === null || deck.formatId === selectedFormat,
  );
  const cardPool = useCardPool(
    [...formatFilteredUserDecks, ...roster.seats.map((seat) => seat.deck)].flatMap((entry) =>
      entry
        ? [
            {
              input: { deck: entry.sourceDeck, commanderName: entry.commanderName },
              format: getFormat(entry.formatId ?? "standard"),
            },
          ]
        : [],
    ),
  );
  const deckValidations = useMemo(() => {
    const map = new Map<
      string,
      {
        legal: boolean;
        errors: string[];
      }
    >();
    for (const entry of userDeckEntries) {
      const format = getFormat(entry.formatId ?? "standard");
      if (!format) continue;
      map.set(
        entry.id,
        validateDeckSections(
          { deck: entry.sourceDeck, commanderName: entry.commanderName },
          format,
          cardPool,
        ),
      );
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedDecks, currentDeck, cardPool]);
  const filteredUserDecks = searchLower
    ? formatFilteredUserDecks.filter((deck) => deck.name.toLowerCase().includes(searchLower))
    : formatFilteredUserDecks;
  useEffect(() => {
    if (
      !selectedFormat ||
      !suggestedOpponent ||
      suggestedOpponent.deck ||
      suggestedOpponent.touched
    )
      return;
    const resolved = resolveAiOpponent({
      presets: presetDecks,
      savedDecks,
      formatId: selectedFormat,
      last: lastAiOpponent,
    });
    if (!resolved) return;
    const source = resolved.source === "preset" ? "preset" : "local";
    dispatchRoster({
      type: "suggest",
      deck: {
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
      },
    });
  }, [selectedFormat, suggestedOpponent, presetDecks, savedDecks, lastAiOpponent]);
  function invalidateHubSelection() {
    hubSelectionRequestIdRef.current += 1;
    setLoadingHubDeckId(null);
    setLoadingSeatId(null);
  }
  function changeFormat(formatId: PlayFormatId | null) {
    if (formatId === selectedFormat) return;
    invalidateHubSelection();
    dispatchRoster({ type: "reset" });
    setSelectedFormat(formatId);
  }
  function assignDeck(
    selected: SelectedDeck,
    seatId = roster.activeSeatId ?? PLAYER_SEAT_ID,
    hubRequestId?: number,
  ) {
    if (hubRequestId === undefined) {
      invalidateHubSelection();
    } else if (hubSelectionRequestIdRef.current !== hubRequestId) {
      return;
    }
    dispatchRoster({ type: "assign", seatId, deck: selected });
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
    const seatId = roster.activeSeatId ?? PLAYER_SEAT_ID;
    const requestId = ++hubSelectionRequestIdRef.current;
    setLoadingHubDeckId(summary.id);
    setLoadingSeatId(seatId);
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
        seatId,
        requestId,
      );
    } catch (err) {
      if (hubSelectionRequestIdRef.current !== requestId) return;
      toast.error(err instanceof Error ? err.message : `Failed to load Community deck`);
    } finally {
      if (hubSelectionRequestIdRef.current === requestId) {
        setLoadingHubDeckId(null);
        setLoadingSeatId(null);
      }
    }
  }
  function selectUserDeck(entry: SelectedDeck) {
    if (!selectedFormat && entry.formatId) setSelectedFormat(entry.formatId);
    assignDeck(entry);
  }
  function handleRandomOpponent(seatId: string) {
    if (!selectedFormat) return;
    const candidates = [
      ...formatFilteredPresets.map(
        (deck): SelectedDeck => ({
          id: `preset:${deck.id ?? deck.name}`,
          sourceId: deck.id ?? deck.name,
          name: deck.name,
          sourceDeck: deck,
          source: "preset",
          formatId: selectedFormat,
          commanderName: deck.commanders?.[0]?.identity.name,
        }),
      ),
      ...formatFilteredUserDecks,
    ].filter((selected) => !offlineSelectionError(selected, selectedFormat, cardPool));
    const random = pickRandom(candidates);
    if (!random) {
      toast.error("No playable decks are available for this format.");
      return;
    }
    assignDeck(random, seatId);
  }
  function handleFight() {
    if (!isReady || starting) return;
    setTableDialogOpen(true);
  }

  function handleTableChosen() {
    setTableDialogOpen(false);
    void startFight();
  }
  async function startFight() {
    if (!launch || !opponentDeck || !isReady || starting) return;
    setStarting(true);
    try {
      const started = await onStart(
        launch.playerDeck.sourceDeck,
        launch.opponentDecks,
        launch.playerDeck.formatId,
        launch.playerDeck.commanderName,
      );
      if (!started) return;
      if (!spectator) {
        if (launch.playerDeck.source === "hub" || launch.playerDeck.source === "preset") {
          void reportPublishedDeckPlay(launch.playerDeck.sourceId, launch.playerDeck.sourceDeck);
        }
        if (launch.playerDeck.source === "preset") {
          savePresetToAccountOnUse(launch.playerDeck.sourceId);
        }
      }
      const prefs = usePreferencesStore.getState();
      if (launch.playerDeck.formatId) prefs.setLastOfflineFormatId(launch.playerDeck.formatId);
      if (!spectator) {
        if (launch.playerDeck.source === "local" && launch.playerDeck.sourceId !== "current") {
          prefs.setLastPlayedDeckId(launch.playerDeck.sourceId);
        }
        if (opponentDeck.source === "preset") {
          prefs.setLastAiOpponent({ kind: "preset", id: opponentDeck.sourceId });
        } else if (opponentDeck.source === "local" && opponentDeck.sourceId !== "current") {
          prefs.setLastAiOpponent({ kind: "saved", id: opponentDeck.sourceId });
        }
      }
    } finally {
      setStarting(false);
    }
  }
  async function startSimulation() {
    if (!launch || !isReady || starting || !spectator || !onSimulate) return;
    setStarting(true);
    try {
      await onSimulate(
        [launch.playerDeck.sourceDeck, ...launch.opponentDecks],
        launch.playerDeck.formatId ?? selectedFormat ?? "standard",
        simulationGames,
      );
      const formatId = launch.playerDeck.formatId ?? selectedFormat;
      if (formatId) usePreferencesStore.getState().setLastOfflineFormatId(formatId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start simulation.");
    } finally {
      setStarting(false);
    }
  }
  const { errors: seatErrors, launch } = prepareOfflineGame(roster, selectedFormat, cardPool);
  const isReady = loadingHubDeckId === null && launch !== null;
  const isCommander = isOfflinePodFormat(selectedFormat);
  const activeAssignment = assignments.find((assignment) => assignment.id === roster.activeSeatId);
  const searchControl = (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        aria-label="Filter decks"
        placeholder={shortTouch ? "Search decks…" : "Filter decks…"}
        value={deckSearch}
        onChange={(event) => setDeckSearch(event.target.value)}
        className="min-h-9 w-full rounded-md border bg-background pl-9 pr-3 text-ui-input focus:outline-none focus:ring-1 focus:ring-primary touch:min-h-11 touch:min-w-11"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto pb-[max(0px,calc(100dvh-var(--visual-viewport-height)-var(--visual-viewport-top)))]">
      {shortTouch ? (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/5 px-4 py-1.5">
          {leadingControl}
          <AppSelect
            aria-label="Filter decks by format"
            value={selectedFormat ?? ""}
            onValueChange={(value) => changeFormat(value || null)}
            className="min-h-11 max-w-44 shrink-0 text-ui-label font-medium"
          >
            <AppSelectOption value="">All formats</AppSelectOption>
            {GAME_FORMATS.map((format) => (
              <AppSelectOption key={format.id} value={format.id}>
                <FormatBadge formatId={format.id} />
                <span className="truncate">{format.name}</span>
              </AppSelectOption>
            ))}
          </AppSelect>
          {searchControl}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-3 border-b bg-muted/5 px-4 py-2 sm:px-6 lg:px-8">
            <div
              role="group"
              aria-label="Filter decks by format"
              className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 py-1 pr-6 no-scrollbar touch-scroll-fade"
            >
              {[{ id: null, name: "All" }, ...GAME_FORMATS].map((format) => (
                <button
                  key={format.id ?? "all"}
                  type="button"
                  aria-pressed={selectedFormat === format.id}
                  onClick={() => changeFormat(format.id)}
                  className={cn(
                    "min-h-9 shrink-0 rounded-full border px-2.5 py-1 text-ui-label font-medium transition-colors motion-reduce:transition-none touch:min-h-11 touch:px-3 touch:min-w-11 whitespace-normal",
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
              className="hidden shrink-0 text-right text-ui-meta font-medium text-muted-foreground lg:block"
              aria-live="polite"
            >
              {activeAssignment ? `Choose a deck for ${activeAssignment.label}` : "Matchup ready"}
            </p>
          </div>
          <div className="shrink-0 px-4 pb-2 pt-3 sm:px-6 lg:px-8">{searchControl}</div>
        </>
      )}

      <div
        className={cn(
          "min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-4 sm:px-6 lg:px-8",
          shortTouch && "space-y-3 pb-2",
        )}
      >
        <div>
          <p className="text-ui-meta uppercase tracking-wider text-muted-foreground font-semibold pt-2 pb-1">
            Your Decks
          </p>
          {filteredUserDecks.length === 0 ? (
            <p className="text-ui-meta text-muted-foreground italic py-2">
              No decks yet — build one in{""}
              <Link
                to={ROUTES.DECK_EDITOR}
                className="touch:inline-flex touch:min-h-11 touch:items-center text-primary underline-offset-2 hover:underline not-italic"
              >
                My Decks
              </Link>
              .
            </p>
          ) : (
            <div
              className={cn(
                "grid gap-3",
                "grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]",
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
                    assignments={assignmentsForDeck(entry.id)}
                    disabled={starting}
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
          (deckSearch.trim() !== "" ||
            hubDecks.loading ||
            hubDecks.error !== null ||
            hubDeckEntries.length > 0) && (
            <div>
              <p className="pb-1 text-ui-meta font-semibold uppercase tracking-wider text-muted-foreground">
                Community
              </p>
              {hubDecks.error ? (
                <div className="flex flex-wrap items-center gap-2 py-2 text-ui-meta text-destructive">
                  <span className="min-w-0 break-words">{hubDecks.error}</span>
                  <Button variant="outline" size="sm" onClick={hubDecks.retry}>
                    Retry
                  </Button>
                </div>
              ) : hubDecks.loading && hubDeckEntries.length === 0 ? (
                <div
                  className={cn(
                    "grid gap-3 pt-1",
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
              ) : hubDeckEntries.length === 0 ? (
                <p className="py-2 text-ui-meta italic text-muted-foreground">
                  No Community decks match this format and search.
                </p>
              ) : (
                <div
                  className={cn(
                    "grid gap-3 pt-1",
                    "grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]",
                  )}
                >
                  {hubDeckEntries.map((deck) => {
                    const selected = roster.seats
                      .map((seat) => seat.deck)
                      .find((entry) => entry?.source === "hub" && entry.sourceId === deck.id);
                    const format = selected ? getFormat(selected.formatId ?? "standard") : null;
                    const validation =
                      selected && format
                        ? validateDeckSections(
                            { deck: selected.sourceDeck, commanderName: selected.commanderName },
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
                        isSelected={false}
                        isLegal={validation.legal}
                        validationError={validation.errors[0]}
                        assignments={assignmentsForDeck(`hub:${deck.id}`)}
                        disabled={starting}
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
          <p className="text-ui-meta uppercase tracking-wider text-muted-foreground font-semibold pb-1">
            Starter Decks
          </p>
          {filteredDecks.length === 0 ? (
            <p className="text-ui-meta text-muted-foreground italic py-2">
              No starter decks for this format.
            </p>
          ) : (
            <div
              className={cn(
                "grid gap-3 pt-1",
                "grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]",
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
                  assignments={assignmentsForDeck(`preset:${deck.id ?? deck.name}`)}
                  disabled={starting}
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

      <div
        className={cn(
          "grid shrink-0 gap-2 border-t bg-muted/10 px-4 py-2 xl:flex xl:items-center xl:justify-between sm:gap-3 sm:px-6 sm:py-3 lg:px-8",
          shortTouch && "sm:px-4 sm:py-1.5",
          denseDecks && "flex items-center",
        )}
      >
        <OfflineRoster
          roster={roster}
          assignments={assignments}
          errors={seatErrors}
          loadingSeatId={loadingSeatId}
          multiplayer={isCommander || spectator}
          spectator={spectator}
          compact={denseDecks}
          disabled={starting}
          randomAvailable={!!selectedFormat}
          onSelect={(seatId) => {
            invalidateHubSelection();
            dispatchRoster({ type: "select", seatId });
          }}
          onClear={(seatId) => {
            invalidateHubSelection();
            dispatchRoster({ type: "clear", seatId });
          }}
          onRemove={(seatId) => {
            invalidateHubSelection();
            dispatchRoster({ type: "remove", seatId });
          }}
          onRandom={handleRandomOpponent}
          onAdd={() => {
            invalidateHubSelection();
            dispatchRoster({ type: "add" });
          }}
        />
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {spectator && onSimulate && (
            <div className="flex items-center gap-2">
              <label htmlFor="ai-simulation-games" className="text-ui-meta text-muted-foreground">
                Games
              </label>
              <select
                id="ai-simulation-games"
                aria-label="Number of simulation games"
                value={simulationGames}
                onChange={(event) => setSimulationGames(Number(event.target.value))}
                disabled={starting}
                className="min-h-11 rounded-md border bg-background px-2 text-ui-label"
              >
                {[5, 10, 25, 50, 100].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
              <Button
                variant="outline"
                size="lg"
                onClick={() => void startSimulation()}
                disabled={!isReady || starting}
                className="min-h-14 gap-2 px-4 text-ui-body font-semibold"
              >
                Simulate
              </Button>
            </div>
          )}
          <Button
            variant="primary"
            size="lg"
            onClick={handleFight}
            disabled={!isReady || starting}
            aria-busy={starting}
            className="min-h-14 w-full gap-2 px-10 text-ui-body font-bold sm:w-auto sm:min-w-48"
          >
            {starting ? <Loader2 className="size-5 animate-spin" /> : <Swords className="size-5" />}
            {starting ? `Starting\u2026` : spectator ? `Watch AI game` : `Fight!`}
          </Button>
        </div>
      </div>
      <TablePickerDialog
        open={tableDialogOpen}
        background={boardBackground}
        onBackgroundChange={setBoardBackground}
        onStart={handleTableChosen}
        onCancel={() => setTableDialogOpen(false)}
        maxPlayers={roster.seats.length}
        players={roster.seats.map((seat, index) => ({
          username: assignments[index].label,
          is_bot: spectator || index > 0,
          selected_deck_name: seat.deck?.name,
          ready: !seatErrors[index],
          connected: true,
        }))}
        centerContent={
          selectedFormat ? (
            <span className="font-serif text-lg font-semibold text-foreground/90">
              {getFormat(selectedFormat)?.name ?? selectedFormat}
            </span>
          ) : undefined
        }
      />
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FEATURES } from "@/lib/features";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormatBadge } from "@/components/game/FormatBadge";
import { EngineMark } from "@/components/lobby/EngineMark";
import { FormatPicker } from "./FormatPicker";
import { DeckSelectionCard } from "./DeckSelectionCard";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { cn, pickRandom } from "@/lib/utils";
import { toast } from "sonner";
import { ROUTES } from "@/lib/constants";
import { resolveAiOpponent } from "@/lib/aiOpponent";
import { getDeckFingerprint } from "@/lib/decks";
import { getFormat, validateDeckSections } from "@/lib/formats";
import { getPlatform } from "@/platform";
import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
import { resolveOfflineEngine } from "@/lib/offlineEngine";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { Deck } from "@/protocol/deck";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Hand,
  Loader2,
  Search,
  Shuffle,
  Swords,
  User,
  Bot,
  X,
} from "lucide-react";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";

interface SelectedDeck {
  id: string;
  name: string;
  desc?: string;
  color?: string;
  sourceDeck: Deck;
  source: "preset" | "user";
  formatId?: string;
  commanderName?: string;
  coverCardName?: string;
}

interface DeckVsSelectorProps {
  preSelectedDeckId?: string;
  showEngineChoice?: boolean;
  onStart: (
    playerDeck: Deck,
    opponentDeck: Deck,
    formatId?: string,
    commanderName?: string,
  ) => Promise<boolean>;
  onStartTabletop?: (deck: Deck, formatId?: string, commanderName?: string) => void;
}

type PickingSide = "player" | "opponent" | null;
type PlayFormatId = string;

export function DeckVsSelector({
  preSelectedDeckId,
  showEngineChoice = true,
  onStart,
  onStartTabletop,
}: DeckVsSelectorProps) {
  const presetDecks = usePresetDecks();
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
          id: preSelectedSavedDeck.id,
          name: preSelectedSavedDeck.deck.name,
          sourceDeck: preSelectedSavedDeck.deck,
          source: "user" as const,
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
  const [stage, setStage] = useState<"format" | "decks">(
    preSelectedDeckEntry || rememberedFormatId ? "decks" : "format",
  );
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
  const opponentTouchedRef = useRef(false);
  const isWeb = getPlatform().type === "web";
  const hostedAvailable = isHostedEngineAvailable();
  const offlineEngine = resolveOfflineEngine(lastOfflineEngine);

  const searchLower = deckSearch.toLowerCase();
  const formatFilteredPresets = presetDecks.filter(
    (deck) => (deck.format ?? "standard") === selectedFormat,
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
      id,
      name: deck.name,
      sourceDeck: deck,
      source: "user" as const,
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
    (deck) => deck.formatId === selectedFormat,
  );
  const filteredUserDecks = searchLower
    ? formatFilteredUserDecks.filter((deck) => deck.name.toLowerCase().includes(searchLower))
    : formatFilteredUserDecks;

  // Drop selected decks if the format changed and they no longer match.
  if (playerDeck && playerDeck.formatId !== selectedFormat) {
    setPlayerDeck(null);
  }
  if (opponentDeck && opponentDeck.formatId !== selectedFormat) {
    setOpponentDeck(null);
    setOpponentConfirmed(false);
  }

  useEffect(() => {
    if (stage !== "decks" || !selectedFormat || opponentDeck || opponentTouchedRef.current) return;
    const resolved = resolveAiOpponent({
      presets: presetDecks,
      savedDecks,
      formatId: selectedFormat,
      last: lastAiOpponent,
    });
    if (!resolved) return;
    setOpponentDeck({
      id: resolved.id,
      name: resolved.deck.name,
      desc: resolved.deck.description,
      color: resolved.deck.color,
      sourceDeck: resolved.deck,
      source: resolved.source === "preset" ? "preset" : "user",
      formatId: selectedFormat,
      commanderName: resolved.deck.commanders?.[0]?.identity.name,
      coverCardName: resolved.deck.coverCardName,
    });
  }, [stage, selectedFormat, opponentDeck, presetDecks, savedDecks, lastAiOpponent]);

  function assignDeck(selected: SelectedDeck) {
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
    if (!selectedFormat) return;
    const id = deck.id ?? deck.name;
    assignDeck({
      id,
      name: deck.name,
      desc: deck.description,
      color: deck.color,
      sourceDeck: deck,
      source: "preset",
      formatId: selectedFormat,
      commanderName: deck.commanders?.[0]?.identity.name,
      coverCardName: deck.coverCardName,
    });
  }

  function selectUserDeck(entry: SelectedDeck) {
    assignDeck(entry);
  }

  function handleRandomOpponent() {
    if (!selectedFormat) return;
    const random = pickRandom(formatFilteredPresets);
    if (!random) return;
    const id = random.id ?? random.name;
    opponentTouchedRef.current = true;
    setOpponentDeck({
      id,
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
    const prefs = usePreferencesStore.getState();
    if (playerDeck.formatId) prefs.setLastOfflineFormatId(playerDeck.formatId);
    if (playerDeck.source === "user" && playerDeck.id !== "current") {
      prefs.setLastPlayedDeckId(playerDeck.id);
    }
    if (opponentDeck.source === "preset") {
      prefs.setLastAiOpponent({ kind: "preset", id: opponentDeck.id });
    } else if (opponentDeck.id !== "current") {
      prefs.setLastAiOpponent({ kind: "saved", id: opponentDeck.id });
    }
  }

  function handleTabletop() {
    if (!playerDeck || playerDeck.sourceDeck.cards.length === 0) return;
    onStartTabletop?.(playerDeck.sourceDeck, playerDeck.formatId, playerDeck.commanderName);
  }

  const isReady = !!playerDeck && !!opponentDeck && opponentConfirmed;
  const canStartTabletop =
    !!onStartTabletop && !!playerDeck && playerDeck.sourceDeck.cards.length > 0;

  if (stage === "format" || selectedFormat === null) {
    return (
      <FormatPicker
        onSelect={(id) => {
          opponentTouchedRef.current = false;
          setPlayerDeck(null);
          setOpponentDeck(null);
          setOpponentConfirmed(false);
          setPickingSide("player");
          setSelectedFormat(id);
          setStage("decks");
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 border-b bg-muted/5 px-4 py-2 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => setStage("format")}
          className="inline-flex min-h-8 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-10"
        >
          <ArrowLeft className="h-3 w-3" />
          Change format
        </button>
        <span className="text-muted-foreground/40">·</span>
        <FormatBadge formatId={selectedFormat} />
        <p
          className="ml-auto min-w-0 truncate text-right text-xs font-medium text-muted-foreground"
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
            placeholder="Filter decks..."
            value={deckSearch}
            onChange={(e) => setDeckSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-md border bg-background text-sm pointer-coarse:text-base focus:outline-none focus:ring-1 focus:ring-primary"
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
                    id={entry.id}
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
                  id={deck.id ?? deck.name}
                  name={deck.name}
                  desc={deck.description}
                  color={deck.color}
                  cards={deck.cards}
                  cover={resolveCoverCard(deck)}
                  coverFallbackClassName="absolute inset-0 bg-gradient-to-br from-muted-foreground/10 via-muted/40 to-muted-foreground/20"
                  isPreset={true}
                  isSelected={false}
                  isPlayerDeck={playerDeck?.id === (deck.id ?? deck.name)}
                  isOpponentDeck={opponentDeck?.id === (deck.id ?? deck.name)}
                  formatId={selectedFormat}
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
            onClick={() => setPickingSide("player")}
            onClear={() => {
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
              setOpponentConfirmed(false);
              setPickingSide("opponent");
            }}
            onClear={() => {
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
          {isWeb && showEngineChoice && (
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
          {FEATURES.tabletop && onStartTabletop && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleTabletop}
              disabled={!canStartTabletop}
              className="w-full gap-1.5 sm:w-auto"
            >
              <Hand className="h-3.5 w-3.5" />
              Tabletop
            </Button>
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

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FEATURES } from "@/lib/features";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { Button } from "@/components/ui/button";
import { FormatBadge } from "@/components/game/FormatBadge";
import { FormatPicker } from "./FormatPicker";
import { DeckSelectionCard } from "./DeckSelectionCard";
import { cn } from "@/lib/utils";
import { getDeckFingerprint } from "@/lib/decks";
import { useDeckStore } from "@/stores/useDeckStore";
import type { Deck } from "@/protocol/deck";
import { ArrowLeft, Hand, Search, Shuffle, Swords, User, Bot, X } from "lucide-react";
import { resolveCoverCard } from "../deck/deckCover.utils";

interface SelectedDeck {
  id: string;
  name: string;
  desc?: string;
  color?: string;
  sourceDeck: Deck;
  formatId?: string;
  commanderName?: string;
  coverCardName?: string;
}

interface DeckVsSelectorProps {
  onStart: (
    playerDeck: Deck,
    opponentDeck: Deck,
    formatId?: string,
    commanderName?: string,
  ) => void;
  onStartTabletop?: (deck: Deck, formatId?: string, commanderName?: string) => void;
}

type PickingSide = "player" | "opponent";
type PlayFormatId = string;

// Lift `Math.random` out of the component body. React's idempotency check
// flags any impure call statically present in render scope, even when the
// surrounding function only runs from an event handler.
function pickRandom<T>(arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function DeckVsSelector({ onStart, onStartTabletop }: DeckVsSelectorProps) {
  const presetDecks = usePresetDecks();
  const [stage, setStage] = useState<"format" | "decks">("format");
  const [playerDeck, setPlayerDeck] = useState<SelectedDeck | null>(null);
  const [opponentDeck, setOpponentDeck] = useState<SelectedDeck | null>(null);
  const [pickingSide, setPickingSide] = useState<PickingSide>("player");
  const [selectedFormat, setSelectedFormat] = useState<PlayFormatId | null>(null);
  const [deckSearch, setDeckSearch] = useState("");
  const { savedDecks, currentDeck } = useDeckStore();

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
    (saved) => !saved.deck.draft && getDeckFingerprint(saved.deck) !== currentDeckFingerprint,
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
      formatId: deck.format ?? "standard",
      commanderName: deck.commanders?.[0]?.name,
    };
  });

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
  }

  function assignDeck(selected: SelectedDeck) {
    if (pickingSide === "player") {
      setPlayerDeck(selected);
      if (!opponentDeck) setPickingSide("opponent");
      return;
    }

    setOpponentDeck(selected);
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
      formatId: selectedFormat,
      commanderName: deck.commanders?.[0]?.name,
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
    setOpponentDeck({
      id,
      name: random.name,
      desc: random.description,
      color: random.color,
      sourceDeck: random,
      formatId: selectedFormat,
      commanderName: random.commanders?.[0]?.name,
      coverCardName: random.coverCardName,
    });
  }

  function handleFight() {
    if (!playerDeck || !opponentDeck) return;
    onStart(
      playerDeck.sourceDeck,
      opponentDeck.sourceDeck,
      playerDeck.formatId,
      playerDeck.commanderName,
    );
  }

  function handleTabletop() {
    if (!playerDeck || playerDeck.sourceDeck.cards.length === 0) return;
    onStartTabletop?.(playerDeck.sourceDeck, playerDeck.formatId, playerDeck.commanderName);
  }

  const isReady = !!playerDeck && !!opponentDeck;
  const canStartTabletop =
    !!onStartTabletop && !!playerDeck && playerDeck.sourceDeck.cards.length > 0;

  if (stage === "format" || selectedFormat === null) {
    return (
      <FormatPicker
        onSelect={(id) => {
          setSelectedFormat(id);
          setStage("decks");
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b bg-muted/5 flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => setStage("format")}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Change format
        </button>
        <span className="text-muted-foreground/40">·</span>
        <FormatBadge formatId={selectedFormat} />
      </div>

      <div className="px-4 pt-3 pb-2 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Filter decks..."
            value={deckSearch}
            onChange={(e) => setDeckSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold pt-2 pb-1">
            Your Decks
          </p>
          {filteredUserDecks.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">
              No decks yet — build one in{" "}
              <Link
                to="/deck-editor"
                className="text-primary underline-offset-2 hover:underline not-italic"
              >
                My Decks
              </Link>
              .
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
              {filteredUserDecks.map((entry) => {
                const displayCards = [
                  ...(entry.sourceDeck?.cards ?? []),
                  ...(entry.sourceDeck?.commanders ?? []),
                ];
                const cover = entry.sourceDeck ? resolveCoverCard(entry.sourceDeck) : undefined;
                return (
                  <DeckSelectionCard
                    key={entry.id}
                    id={entry.id}
                    name={entry.name}
                    color={entry.color}
                    cards={displayCards}
                    cover={cover}
                    labels={entry.sourceDeck?.labels}
                    isPreset={false}
                    isSelected={false}
                    isPlayerDeck={playerDeck?.id === entry.id}
                    isOpponentDeck={opponentDeck?.id === entry.id}
                    formatId={entry.sourceDeck?.format ?? entry.formatId ?? "standard"}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 pt-1">
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
                  onSelect={() => selectDeck(deck)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-t flex items-center justify-between gap-3 bg-muted/10 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <DeckSlot
            label="YOU"
            icon={<User className="h-3 w-3" />}
            deck={playerDeck}
            sideColor="var(--player-colors-self)"
            isActive={pickingSide === "player"}
            onClick={() => setPickingSide("player")}
            onClear={() => setPlayerDeck(null)}
          />
          <span className="text-xs font-bold tracking-wider text-muted-foreground/60">VS</span>
          <DeckSlot
            label="AI"
            icon={<Bot className="h-3 w-3" />}
            deck={opponentDeck}
            sideColor="var(--player-colors-opponent1)"
            isActive={pickingSide === "opponent"}
            onClick={() => setPickingSide("opponent")}
            onClear={() => setOpponentDeck(null)}
            placeholderExtra={
              !opponentDeck && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRandomOpponent();
                  }}
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  title="Random AI deck"
                >
                  <Shuffle className="h-3 w-3" />
                </button>
              )
            }
          />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {FEATURES.tabletop && onStartTabletop && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleTabletop}
              disabled={!canStartTabletop}
              className="gap-1.5"
            >
              <Hand className="h-3.5 w-3.5" />
              Tabletop
            </Button>
          )}
          <Button size="sm" onClick={handleFight} disabled={!isReady} className="gap-1.5">
            <Swords className="h-3.5 w-3.5" />
            Fight!
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
  onClick,
  onClear,
  placeholderExtra,
}: DeckSlotProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
        isActive ? "ring-1" : "border-border/40 hover:border-border hover:bg-muted/40",
      )}
      style={{
        borderColor: isActive ? sideColor : undefined,
        boxShadow: isActive
          ? `inset 0 0 0 1px color-mix(in srgb, ${sideColor} 35%, transparent)`
          : undefined,
      }}
    >
      <span
        className="inline-flex items-center gap-0.5 font-bold text-[10px] uppercase tracking-wider"
        style={{ color: sideColor }}
      >
        {icon}
        {label}
      </span>
      {deck ? (
        <>
          <span className="truncate font-medium text-foreground/90">{deck.name}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClear();
              }
            }}
            className="ml-0.5 inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-destructive"
            title="Clear"
          >
            <X className="h-2.5 w-2.5" />
          </span>
        </>
      ) : (
        <>
          <span className="italic text-muted-foreground">pick a deck</span>
          {placeholderExtra}
        </>
      )}
    </button>
  );
}

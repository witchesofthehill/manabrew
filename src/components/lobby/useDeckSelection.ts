import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useGameDevStore } from "@/stores/useGameDevStore";
import type { Deck, DeckCard } from "@/protocol/deck";
import type { EngineKind, PlayerDeckInfo } from "@/protocol";
import {
  GAME_FORMATS,
  validateDeckSections,
  commanderPairLabel,
  type GameFormat,
} from "@/lib/formats";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import {
  availableEngines,
  hubEntryEngines,
  supportsAvailableEngine,
  supportsEngine,
} from "@/lib/engines";
import { getDeckFingerprint } from "@/lib/decks";
import { useHubDeckSearch } from "@/hooks/useHubDeckSearch";
import { useCardPool } from "@/hooks/useCardPool";
import { useHubStore } from "@/stores/useHubStore";
import type { DeckHubEntryDetail, DeckHubEntrySummary } from "@/api/hubTypes";

import type { CardPool, DeckValidation, DeckValidationInput } from "@/lib/formats";

export interface DeckPickerEntry {
  id: string;
  name: string;
  badge?: string | null;
  labels?: Deck["labels"];
  desc?: string;
  color?: string;
  sourceDeck: Deck;
  isPreset: boolean;
  cover: DeckCard | undefined;
  cards: DeckCard[];
  formatId: string;
  commanderName?: string;
}

export interface DeckSelectionModel {
  selectedFormat: GameFormat;
  setSelectedFormat: (format: GameFormat) => void;
  selectedDeck: string;
  selectedCommander: string;
  chooseCommander: (name: string) => void;
  playerCount: number;
  setPlayerCount: (count: number) => void;
  deckSearch: string;
  setDeckSearch: (search: string) => void;
  denseDecks: boolean;
  isTouch: boolean;
  hubDecks: {
    enabled: boolean;
    loading: boolean;
    error: string | null;
    retry: () => void;
  };
  hubSearchResults: DeckHubEntrySummary[];
  loadedHubDecks: Record<string, DeckHubEntryDetail>;
  loadingHubDeckId: string | null;
  previousDeckEntry: DeckPickerEntry | undefined;
  filteredUserDecks: DeckPickerEntry[];
  filteredPresetEntries: DeckPickerEntry[];
  searchLower: string;
  cardPool: CardPool;
  userDeckValidationInput: (entry: DeckPickerEntry) => DeckValidationInput;
  hubDeckValidationInput: (deck: Deck) => DeckValidationInput;
  selectedDeckEntry: DeckPickerEntry | undefined;
  selectedDeckCommanders: DeckCard[];
  selectedPartnerLabel: string | null;
  legendaryCreatures: string[];
  needsCommander: boolean;
  selectedDeckValidation: DeckValidation;
  isReady: boolean;
  starting: boolean;
  selectDeck: (id: string) => void;
  selectHubDeck: (deck: DeckHubEntrySummary, activate?: boolean) => Promise<void>;
  handleCreate: (entry?: DeckPickerEntry, commanderOverride?: string) => Promise<void>;
  handleOpenChange: (open: boolean) => void;
  invalidateHubSelection: () => void;
  disabled: boolean;
}

interface DeckSelectionOptions {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  mode?: "play" | "lobby";
  engineKind?: EngineKind;
  forcedFormatId?: string;
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  preSelectedDeck?: PlayerDeckInfo;
  target?: "player" | "bot";
  onStart: (
    deck: Deck,
    formatId: string,
    commanderName?: string,
    playerCount?: number,
    publishedDeckId?: string,
  ) => void | Promise<void>;
}

export function useDeckSelection({
  open,
  onOpenChange,
  mode = "play",
  engineKind,
  forcedFormatId,
  preSelectedDeckId,
  preSelectedHubDeckId,
  preSelectedDeck,
  target = "player",
  onStart,
}: DeckSelectionOptions): DeckSelectionModel {
  const currentDeck = useDeckStore((state) => state.currentDeck);
  const isReadOnly = useDeckStore((state) => state.isReadOnly);
  const ownedDecks = useOwnedDecks();
  const accountDeckDetails = useAccountDecksStore((state) => state.details);
  const allowIllegalDecks = useGameDevStore((s) => s.allowIllegalDecks);
  const isLobbyMode = mode === "lobby";
  const denseDecks = useIsShortScreen();
  const isTouch = useIsTouch();
  const initialFormat = GAME_FORMATS.find((f) => f.id === forcedFormatId) ?? GAME_FORMATS[0];
  const [selectedFormat, setSelectedFormat] = useState<GameFormat>(initialFormat);
  const [selectedDeck, setSelectedDeck] = useState<string>(
    preSelectedDeck ? "previous" : (preSelectedDeckId ?? "current"),
  );
  const [selectedCommander, setSelectedCommander] = useState<string>(
    preSelectedDeck?.commander_name ?? currentDeck.commanders?.[0]?.identity.name ?? "",
  );
  const presetDecks = usePresetDecks(engineKind);
  const [playerCount, setPlayerCount] = useState(2);
  const [deckSearch, setDeckSearch] = useState("");
  const [loadedHubDecks, setLoadedHubDecks] = useState<Record<string, DeckHubEntryDetail>>({});
  const [loadingHubDeckId, setLoadingHubDeckId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const selectionContextRef = useRef({ open, forcedFormatId, engineKind });
  selectionContextRef.current = { open, forcedFormatId, engineKind };
  const selectedFormatRef = useRef(selectedFormat);
  selectedFormatRef.current = selectedFormat;
  const deckFormatId = selectedFormat.deckFormat ?? selectedFormat.id;
  const hubDecks = useHubDeckSearch(
    deckSearch,
    deckFormatId,
    open,
    engineKind ? [engineKind] : availableEngines(),
    "community",
  );
  const hubSearchResults = hubDecks.decks.filter((entry) =>
    engineKind
      ? supportsEngine(hubEntryEngines(entry), engineKind)
      : supportsAvailableEngine(hubEntryEngines(entry)),
  );
  const loadHubDeck = useHubStore((state) => state.loadEntry);
  const hubSelectionRequestIdRef = useRef(0);
  useEffect(() => {
    setStarting(false);
    startingRef.current = false;
    return () => {
      hubSelectionRequestIdRef.current += 1;
    };
  }, [open, forcedFormatId, engineKind]);
  useEffect(() => {
    if (!forcedFormatId) return;
    const forced = GAME_FORMATS.find((f) => f.id === forcedFormatId);
    if (forced) {
      hubSelectionRequestIdRef.current += 1;
      setLoadingHubDeckId(null);
      setSelectedFormat(forced);
      setStarting(false);
      startingRef.current = false;
    }
  }, [forcedFormatId]);
  useEffect(() => {
    if (preSelectedDeckId && !preSelectedDeck) {
      hubSelectionRequestIdRef.current += 1;
      setLoadingHubDeckId(null);
      setSelectedDeck(preSelectedDeckId);
    }
  }, [preSelectedDeckId, preSelectedDeck]);
  useEffect(() => {
    if (!open || !hubDecks.enabled) {
      hubSelectionRequestIdRef.current += 1;
      setLoadingHubDeckId(null);
      return;
    }
    if (preSelectedDeck || !preSelectedHubDeckId) return;
    const requestId = ++hubSelectionRequestIdRef.current;
    setLoadingHubDeckId(preSelectedHubDeckId);
    void loadHubDeck(preSelectedHubDeckId)
      .then((detail) => {
        if (hubSelectionRequestIdRef.current !== requestId) return;
        const formatId = detail.deck.format ?? detail.format ?? "standard";
        if (formatId !== deckFormatId) {
          toast.error(`"${detail.title}" is not a ${selectedFormat.name} deck`);
          return;
        }
        setLoadedHubDecks((current) => ({ ...current, [detail.id]: detail }));
        setSelectedDeck(`hub:${detail.id}`);
      })
      .catch((err) => {
        if (hubSelectionRequestIdRef.current !== requestId) return;
        toast.error(err instanceof Error ? err.message : `Failed to load Community deck`);
      })
      .finally(() => {
        if (hubSelectionRequestIdRef.current === requestId) setLoadingHubDeckId(null);
      });
  }, [
    hubDecks.enabled,
    loadHubDeck,
    open,
    preSelectedHubDeckId,
    preSelectedDeck,
    deckFormatId,
    selectedFormat.name,
  ]);
  const currentDeckFingerprint = getDeckFingerprint(currentDeck);
  const distinctSavedDecks = ownedDecks.filter(
    (saved) =>
      isReadOnly ||
      saved.id === preSelectedDeckId ||
      getDeckFingerprint(saved.deck) !== currentDeckFingerprint,
  );
  const currentDeckIsPlayable =
    !isReadOnly && (currentDeck.cards.length > 0 || (currentDeck.commanders?.length ?? 0) > 0);
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
  const previousDeckEntry = preSelectedDeck
    ? {
        id: "previous",
        name: preSelectedDeck.deck_name,
        badge: "assigned",
        labels: preSelectedDeck.deck.labels,
        sourceDeck: preSelectedDeck.deck,
        isPreset: false as const,
        cover: resolveCoverCard(preSelectedDeck.deck),
        cards: allDeckCards(preSelectedDeck.deck),
        formatId: preSelectedDeck.deck.format ?? deckFormatId,
        commanderName: preSelectedDeck.commander_name,
      }
    : undefined;
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
    name: detail.title,
    desc: detail.summary,
    color: detail.colors,
    badge: "Community",
    sourceDeck: detail.deck,
    isPreset: false as const,
    cover: resolveCoverCard(detail.deck),
    cards: allDeckCards(detail.deck),
    formatId: detail.deck.format ?? detail.format ?? "standard",
    commanderName: detail.deck.commanders?.[0]?.identity.name,
  }));
  const allDecks = [
    ...(previousDeckEntry ? [previousDeckEntry] : []),
    ...userDecks,
    ...hubDeckEntries,
    ...presetDeckEntries,
  ];
  const searchLower = deckSearch.toLowerCase();
  const filteredPreviousDeck =
    previousDeckEntry?.formatId === deckFormatId &&
    previousDeckEntry.name.toLowerCase().includes(searchLower)
      ? previousDeckEntry
      : undefined;
  const formatPresetEntries = presetDeckEntries.filter((d) => d.formatId === deckFormatId);
  const filteredPresetEntries = searchLower
    ? formatPresetEntries.filter(
        (d) =>
          d.name.toLowerCase().includes(searchLower) || d.desc?.toLowerCase().includes(searchLower),
      )
    : formatPresetEntries;
  const formatUserDecks = userDecks.filter((d) => d.formatId === deckFormatId);
  const filteredUserDecks = searchLower
    ? formatUserDecks.filter((d) => d.name.toLowerCase().includes(searchLower))
    : formatUserDecks;
  const defaultCommander = allDecks.find((d) => d.id === selectedDeck)?.commanderName ?? "";
  useEffect(() => {
    setSelectedCommander(defaultCommander);
  }, [selectedDeck, defaultCommander]);
  const selectedDeckEntry = allDecks.find(
    (d) => d.id === selectedDeck && d.formatId === deckFormatId,
  );
  const userDeckValidationInput = (d: DeckPickerEntry) => ({
    deck: d.sourceDeck,
    commanderName: selectedFormat.deckRules.requiresCommander
      ? d.id === selectedDeck
        ? selectedCommander || d.commanderName
        : d.commanderName
      : undefined,
  });
  const hubDeckValidationInput = (deck: Deck) => ({
    deck,
    commanderName: deck.commanders?.[0]?.identity.name,
  });
  const cardPool = useCardPool([
    ...filteredUserDecks.map((d) => ({
      input: userDeckValidationInput(d),
      format: selectedFormat,
    })),
    ...(selectedDeckEntry && !selectedDeckEntry.isPreset
      ? [
          {
            input: {
              deck: selectedDeckEntry.sourceDeck,
              commanderName: selectedCommander || selectedDeckEntry.commanderName,
            },
            format: selectedFormat,
          },
        ]
      : []),
    ...hubSearchResults.flatMap((deck) =>
      loadedHubDecks[deck.id]
        ? [{ input: hubDeckValidationInput(loadedHubDecks[deck.id].deck), format: selectedFormat }]
        : [],
    ),
  ]);
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
    filteredPreviousDeck?.id === selectedDeck ||
    [...filteredUserDecks, ...filteredPresetEntries].some((entry) => entry.id === selectedDeck) ||
    hubSearchResults.some((entry) => `hub:${entry.id}` === selectedDeck) ||
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
          cardPool,
        )
    : { legal: false, errors: [] as string[] };
  const isReady =
    selectedDeckIsVisible && (selectedDeckValidation.legal || allowIllegalDecks) && commanderValid;
  function invalidateHubSelection() {
    hubSelectionRequestIdRef.current += 1;
    setLoadingHubDeckId(null);
  }
  function selectDeck(deckId: string) {
    if (startingRef.current) return;
    invalidateHubSelection();
    setSelectedDeck(deckId);
    setSelectedCommander(allDecks.find((entry) => entry.id === deckId)?.commanderName ?? "");
  }
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) invalidateHubSelection();
    onOpenChange?.(nextOpen);
  }
  async function selectHubDeck(summary: DeckHubEntrySummary, activate = false) {
    if (startingRef.current) return;
    const requestId = ++hubSelectionRequestIdRef.current;
    const context = selectionContextRef.current;
    setLoadingHubDeckId(summary.id);
    try {
      const detail = await loadHubDeck(summary.id);
      if (
        hubSelectionRequestIdRef.current !== requestId ||
        selectionContextRef.current.open !== context.open ||
        selectionContextRef.current.forcedFormatId !== context.forcedFormatId ||
        selectionContextRef.current.engineKind !== context.engineKind
      )
        return;
      setLoadedHubDecks((current) => ({ ...current, [detail.id]: detail }));
      const formatId = detail.deck.format ?? detail.format ?? "standard";
      const currentFormat = selectedFormatRef.current;
      if (formatId !== (currentFormat.deckFormat ?? currentFormat.id)) {
        toast.error(`"${detail.title}" is not a ${currentFormat.name} deck`);
        return;
      }
      setSelectedDeck(`hub:${detail.id}`);
      setSelectedCommander(detail.deck.commanders?.[0]?.identity.name ?? "");
      if (activate) {
        await handleCreate(
          {
            id: `hub:${detail.id}`,
            name: detail.title,
            desc: detail.summary,
            color: detail.colors,
            badge: "Community",
            sourceDeck: detail.deck,
            isPreset: false,
            cover: resolveCoverCard(detail.deck),
            cards: allDeckCards(detail.deck),
            formatId,
            commanderName: detail.deck.commanders?.[0]?.identity.name,
          },
          detail.deck.commanders?.[0]?.identity.name,
        );
      }
    } catch (err) {
      if (hubSelectionRequestIdRef.current !== requestId) return;
      toast.error(err instanceof Error ? err.message : `Failed to load Community deck`);
    } finally {
      if (hubSelectionRequestIdRef.current === requestId) setLoadingHubDeckId(null);
    }
  }
  async function handleCreate(
    entry: DeckPickerEntry | undefined = selectedDeckIsVisible ? selectedDeckEntry : undefined,
    commanderOverride?: string,
  ) {
    if (startingRef.current) return;
    if (!entry) {
      toast.error(`Please select a deck`);
      return;
    }
    if (entry.formatId !== deckFormatId) {
      toast.error(`Please select a deck for this format`);
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
          cardPool,
        );
    if (!validation.legal && !allowIllegalDecks) {
      toast.warning(validation.errors[0] ?? `Deck is not legal in this format`);
      return;
    }
    if (needsCommander && !(commander || entry.commanderName)) {
      toast.error(`Please select a commander`);
      return;
    }
    const requestId = hubSelectionRequestIdRef.current;
    const context = selectionContextRef.current;
    startingRef.current = true;
    setStarting(true);
    let completed = false;
    try {
      let publishedDeckId =
        entry.id === "previous"
          ? preSelectedDeck?.published_deck_id
          : entry.id.startsWith("hub:")
            ? entry.id.slice(4)
            : undefined;
      const savedEntry = ownedDecks.find((saved) => saved.id === entry.id);
      const rankingPresetKey = entry.isPreset
        ? entry.sourceDeck.id
        : savedEntry?.accountDeckId
          ? accountDeckDetails[savedEntry.accountDeckId]?.derivedFromPresetKey
          : undefined;
      if (isLobbyMode && target !== "bot" && rankingPresetKey && hubDecks.enabled) {
        try {
          const published = await loadHubDeck(rankingPresetKey);
          if (getDeckFingerprint(published.deck) === getDeckFingerprint(entry.sourceDeck)) {
            publishedDeckId = published.id;
          }
        } catch {
          publishedDeckId = undefined;
        }
      }
      if (
        hubSelectionRequestIdRef.current !== requestId ||
        selectionContextRef.current.open !== context.open ||
        selectionContextRef.current.forcedFormatId !== context.forcedFormatId ||
        selectionContextRef.current.engineKind !== context.engineKind
      )
        return;
      await onStart(
        entry.sourceDeck,
        selectedFormat.id,
        selectedFormat.deckRules.requiresCommander ? commander || entry.commanderName : undefined,
        playerCount,
        publishedDeckId,
      );
      completed = true;
    } catch (error) {
      if (hubSelectionRequestIdRef.current === requestId) {
        toast.error(error instanceof Error ? error.message : "Failed to select deck");
      }
    } finally {
      if (hubSelectionRequestIdRef.current === requestId) {
        startingRef.current = false;
        setStarting(false);
        if (completed) handleOpenChange(false);
      }
    }
  }
  function chooseCommander(name: string) {
    setSelectedCommander(name);
  }
  return {
    selectedFormat,
    setSelectedFormat,
    selectedDeck,
    selectedCommander,
    chooseCommander,
    playerCount,
    setPlayerCount,
    deckSearch,
    setDeckSearch,
    denseDecks,
    isTouch,
    hubDecks,
    hubSearchResults,
    loadedHubDecks,
    loadingHubDeckId,
    previousDeckEntry: filteredPreviousDeck,
    filteredUserDecks,
    filteredPresetEntries,
    searchLower,
    cardPool,
    userDeckValidationInput,
    hubDeckValidationInput,
    selectedDeckEntry,
    selectedDeckCommanders,
    selectedPartnerLabel,
    legendaryCreatures,
    needsCommander,
    selectedDeckValidation,
    isReady,
    starting,
    selectDeck,
    selectHubDeck,
    handleCreate,
    handleOpenChange,
    invalidateHubSelection,
    disabled: starting,
  };
}

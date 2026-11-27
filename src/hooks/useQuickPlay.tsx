import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { SelectedDeck } from "@/components/lobby/deckSelection.types";
import { isOfflinePodFormat } from "@/components/lobby/offlineRoster.utils";
import { singlePlayerDeck } from "@/game/singlePlayerSetup";
import type { SinglePlayerSetup } from "@/game/singlePlayerSetup";
import { resolveAiOpponent } from "@/lib/aiOpponent";
import type { ResolvedAiOpponent } from "@/lib/aiOpponent";
import { ROUTES } from "@/lib/constants";
import { reportPublishedDeckPlay } from "@/lib/deckPlayEvidence";
import { getFormat } from "@/lib/formats";
import { resolveOfflineEngine } from "@/lib/offlineEngine";
import { presetSupportsEngine, type PresetDeck } from "@/lib/presetDecks";
import { useDeckStore } from "@/stores/useDeckStore";
import { useGameStore } from "@/stores/useGameStore";
import { noteClientMatchSource } from "@/lib/clientAnalyticsFunnel";
import { useHubStore } from "@/stores/useHubStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { prefetchPresetDecks, usePresetDecksStore } from "@/stores/usePresetDecksStore";
import type { Deck } from "@/protocol/deck";
import type { EngineKind } from "@/protocol";

function unavailableDeckMessage(engines: EngineKind[] | undefined) {
  return engines?.includes("Ironsmith")
    ? "This deck needs Ironsmith. Start an Ironsmith table from Multiplayer."
    : "This deck is not available for play on Forge.";
}

async function ensurePresets(engine: EngineKind): Promise<PresetDeck[]> {
  if (usePresetDecksStore.getState().decks.length === 0) {
    await prefetchPresetDecks();
  }
  return usePresetDecksStore.getState().decks.filter((deck) => presetSupportsEngine(deck, engine));
}
async function resolveOpponents(
  engine: EngineKind,
  formatId: string,
): Promise<{
  decks: Deck[];
  remember: ResolvedAiOpponent | null;
}> {
  const presets = await ensurePresets(engine);
  const opponent = resolveAiOpponent({
    presets,
    savedDecks: useDeckStore.getState().savedDecks,
    formatId,
    last: usePreferencesStore.getState().lastAiOpponent,
  });
  return { decks: opponent ? [opponent.deck] : [], remember: opponent };
}
function quickPlaySetup(
  deck: SelectedDeck,
  engine: EngineKind,
  opponent: ResolvedAiOpponent | null,
): SinglePlayerSetup {
  return {
    engine,
    formatId: deck.formatId ?? "standard",
    seats: [
      { id: "player", deck },
      ...(opponent
        ? [
            {
              id: "bot-1",
              deck: singlePlayerDeck(
                opponent.deck,
                opponent.source === "preset" ? "preset" : "local",
                opponent.id,
              ),
            },
          ]
        : []),
    ],
  };
}
export function useQuickPlay() {
  const navigate = useNavigate();
  const [pendingDeckId, setPendingDeckId] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const startSaved = useCallback(
    async (savedDeckId: string) => {
      if (pendingRef.current) return;
      const saved = useDeckStore.getState().savedDecks.find((entry) => entry.id === savedDeckId);
      if (!saved) return;
      pendingRef.current = true;
      setPendingDeckId(savedDeckId);
      try {
        const deck = saved.deck;
        const formatId = deck.format ?? "standard";
        const format = getFormat(formatId);
        if (!format) {
          toast.error(`This deck uses an unsupported format.`);
          navigate(`${ROUTES.DECK_EDITOR}?deck=${encodeURIComponent(savedDeckId)}`, {
            state: { deckEditorFromList: true },
          });
          return;
        }
        const engine = resolveOfflineEngine();
        const opponents = await resolveOpponents(engine, formatId);
        if (!mountedRef.current) return;
        if (opponents.decks.length === 0) {
          toast.error(`No AI deck available for this format \u2014 pick one yourself.`);
          navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, {
            state: { preSelectedDeckId: savedDeckId },
          });
          return;
        }
        noteClientMatchSource("my_deck");
        const started = await useGameStore
          .getState()
          .startGame(
            "match",
            deck,
            formatId,
            deck.commanders?.[0]?.identity.name,
            opponents.decks,
            engine,
            undefined,
            quickPlaySetup(
              singlePlayerDeck(deck, "local", savedDeckId),
              engine,
              opponents.remember,
            ),
          );
        if (!started) return;
        const prefs = usePreferencesStore.getState();
        prefs.setLastOfflineFormatId(formatId);
        prefs.setLastPlayedDeckId(savedDeckId);
        if (opponents.remember) {
          prefs.setLastAiOpponent(
            opponents.remember.source === "preset"
              ? { kind: "preset", id: opponents.remember.id }
              : { kind: "saved", id: opponents.remember.id },
          );
        }
      } finally {
        pendingRef.current = false;
        if (mountedRef.current) setPendingDeckId(null);
      }
    },
    [navigate],
  );
  const startPreset = useCallback(async (preset: PresetDeck) => {
    if (pendingRef.current) return;
    const presetId = preset.id ?? preset.name;
    pendingRef.current = true;
    setPendingDeckId(presetId);
    try {
      const formatId = preset.format ?? "standard";
      const engine = resolveOfflineEngine();
      const opponents = await resolveOpponents(engine, formatId);
      if (!mountedRef.current) return;
      if (opponents.decks.length === 0) {
        toast.error(`No AI deck available for this format \u2014 pick one yourself.`);
        return;
      }
      noteClientMatchSource("preset");
      const started = await useGameStore
        .getState()
        .startGame(
          "match",
          preset,
          formatId,
          preset.commanders?.[0]?.identity.name,
          opponents.decks,
          engine,
          undefined,
          quickPlaySetup(singlePlayerDeck(preset, "preset", presetId), engine, opponents.remember),
        );
      if (!started) return;
      void reportPublishedDeckPlay(presetId, preset);
      const prefs = usePreferencesStore.getState();
      prefs.setLastOfflineFormatId(formatId);
      if (opponents.remember) {
        prefs.setLastAiOpponent(
          opponents.remember.source === "preset"
            ? { kind: "preset", id: opponents.remember.id }
            : { kind: "saved", id: opponents.remember.id },
        );
      }
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPendingDeckId(null);
    }
  }, []);
  const startCommunity = useCallback(async (entryId: string, deck: Deck) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingDeckId(entryId);
    try {
      const formatId = deck.format ?? "standard";
      const engine = resolveOfflineEngine();
      const opponents = await resolveOpponents(engine, formatId);
      if (!mountedRef.current) return;
      if (opponents.decks.length === 0) {
        toast.error(`No AI deck available for this format \u2014 pick one yourself.`);
        return;
      }
      noteClientMatchSource("community");
      const started = await useGameStore
        .getState()
        .startGame(
          "match",
          deck,
          formatId,
          deck.commanders?.[0]?.identity.name,
          opponents.decks,
          engine,
          undefined,
          quickPlaySetup(singlePlayerDeck(deck, "hub", entryId), engine, opponents.remember),
        );
      if (!started) return;
      void reportPublishedDeckPlay(entryId, deck);
      const prefs = usePreferencesStore.getState();
      prefs.setLastOfflineFormatId(formatId);
      if (opponents.remember) {
        prefs.setLastAiOpponent(
          opponents.remember.source === "preset"
            ? { kind: "preset", id: opponents.remember.id }
            : { kind: "saved", id: opponents.remember.id },
        );
      }
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPendingDeckId(null);
    }
  }, []);
  const quickPlay = useCallback(
    async (savedDeckId: string) => {
      if (pendingRef.current) return;
      const saved = useDeckStore.getState().savedDecks.find((entry) => entry.id === savedDeckId);
      if (!saved) return;
      const formatId = saved.deck.format ?? "standard";
      if (isOfflinePodFormat(formatId)) {
        const preSelectedDeck: SelectedDeck = {
          id: `local:${savedDeckId}`,
          sourceId: savedDeckId,
          name: saved.deck.name,
          sourceDeck: saved.deck,
          source: "local",
          formatId,
          commanderName: saved.deck.commanders?.[0]?.identity.name,
        };
        noteClientMatchSource("my_deck");
        navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, { state: { preSelectedDeck } });
        return;
      }
      await startSaved(savedDeckId);
    },
    [navigate, startSaved],
  );
  const quickPlayPreset = useCallback(
    async (preset: PresetDeck) => {
      if (pendingRef.current) return;
      const formatId = preset.format ?? "standard";
      if (formatId === "oathbreaker" || getFormat(formatId) === undefined) {
        toast.error(`This starter deck uses an unsupported format.`);
        return;
      }
      if (!presetSupportsEngine(preset, resolveOfflineEngine())) {
        toast.error(unavailableDeckMessage(preset.engines));
        return;
      }
      if (isOfflinePodFormat(formatId)) {
        const sourceId = preset.id ?? preset.name;
        const preSelectedDeck: SelectedDeck = {
          id: `preset:${sourceId}`,
          sourceId,
          name: preset.name,
          desc: preset.description,
          color: preset.color,
          sourceDeck: preset,
          source: "preset",
          formatId,
          commanderName: preset.commanders?.[0]?.identity.name,
          coverCardName: preset.coverCardName,
        };
        noteClientMatchSource("preset");
        navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, { state: { preSelectedDeck } });
        return;
      }
      await startPreset(preset);
    },
    [navigate, startPreset],
  );
  const quickPlayCommunity = useCallback(
    async (entryId: string) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPendingDeckId(entryId);
      try {
        const entry = await useHubStore.getState().loadEntry(entryId);
        if (!mountedRef.current) return;
        const formatId = entry.deck.format ?? entry.format ?? "standard";
        if (getFormat(formatId) === undefined) {
          toast.error(`This Community deck uses an unsupported format.`);
          return;
        }
        const engine = resolveOfflineEngine();
        if (entry.engines?.length && !entry.engines.includes(engine)) {
          toast.error(unavailableDeckMessage(entry.engines));
          return;
        }
        if (isOfflinePodFormat(formatId)) {
          const preSelectedDeck: SelectedDeck = {
            id: `hub:${entryId}`,
            sourceId: entryId,
            name: entry.deck.name,
            sourceDeck: entry.deck,
            source: "hub",
            formatId,
            commanderName: entry.deck.commanders?.[0]?.identity.name,
            coverCardName: entry.deck.coverCardName,
          };
          noteClientMatchSource("community");
          navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, { state: { preSelectedDeck } });
          return;
        }
        pendingRef.current = false;
        await startCommunity(entryId, entry.deck);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load Community deck");
      } finally {
        pendingRef.current = false;
        if (mountedRef.current) setPendingDeckId(null);
      }
    },
    [navigate, startCommunity],
  );
  return { quickPlay, quickPlayPreset, quickPlayCommunity, pendingDeckId };
}

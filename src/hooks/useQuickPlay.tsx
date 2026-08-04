import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PlaytestPlayersDialog } from "@/components/lobby/PlaytestPlayersDialog";
import { resolveAiOpponent } from "@/lib/aiOpponent";
import { ROUTES } from "@/lib/constants";
import { reportPublishedDeckPlay } from "@/lib/deckPlayEvidence";
import { getFormat } from "@/lib/formats";
import { resolveOfflineEngine } from "@/lib/offlineEngine";
import { presetSupportsEngine, type PresetDeck } from "@/lib/presetDecks";
import { savePresetToAccountOnUse } from "@/lib/presetDeckAccount";
import { pickRandomDistinct } from "@/lib/utils";
import { useDeckStore } from "@/stores/useDeckStore";
import { useGameStore } from "@/stores/useGameStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { prefetchPresetDecks, usePresetDecksStore } from "@/stores/usePresetDecksStore";
import type { Deck } from "@/protocol/deck";
import type { EngineKind } from "@/protocol";

type PendingPod = { kind: "saved"; savedDeckId: string } | { kind: "preset"; preset: PresetDeck };

async function ensurePresets(engine: EngineKind): Promise<PresetDeck[]> {
  if (usePresetDecksStore.getState().decks.length === 0) {
    await prefetchPresetDecks();
  }
  return usePresetDecksStore.getState().decks.filter((deck) => presetSupportsEngine(deck, engine));
}

async function resolveOpponents(
  engine: EngineKind,
  formatId: string,
  opponentCount: number,
): Promise<{ decks: Deck[]; remember: ReturnType<typeof resolveAiOpponent> }> {
  const presets = await ensurePresets(engine);
  if (opponentCount === 1) {
    const opponent = resolveAiOpponent({
      presets,
      savedDecks: useDeckStore.getState().savedDecks,
      formatId,
      last: usePreferencesStore.getState().lastAiOpponent,
    });
    return { decks: opponent ? [opponent.deck] : [], remember: opponent };
  }
  const pool = presets.filter(
    (preset) =>
      (preset.format ?? "standard") === formatId &&
      preset.cards.length + (preset.commanders?.length ?? 0) > 0,
  );
  return { decks: pickRandomDistinct(pool, opponentCount), remember: null };
}

export function useQuickPlay() {
  const navigate = useNavigate();
  const [pendingDeckId, setPendingDeckId] = useState<string | null>(null);
  const [pendingPod, setPendingPod] = useState<PendingPod | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const startSaved = useCallback(
    async (savedDeckId: string, opponentCount: number) => {
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
          toast.error("This deck uses an unsupported format.");
          navigate(`${ROUTES.DECK_EDITOR}?deck=${encodeURIComponent(savedDeckId)}`, {
            state: { deckEditorFromList: true },
          });
          return;
        }
        const engine = resolveOfflineEngine();
        const opponents = await resolveOpponents(engine, formatId, opponentCount);
        if (!mountedRef.current) return;
        if (opponents.decks.length === 0) {
          toast.error("No AI deck available for this format — pick one yourself.");
          navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, {
            state: { preSelectedDeckId: savedDeckId },
          });
          return;
        }
        const started = await useGameStore
          .getState()
          .startGame(deck, formatId, deck.commanders?.[0]?.identity.name, opponents.decks, engine);
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

  const startPreset = useCallback(async (preset: PresetDeck, opponentCount: number) => {
    if (pendingRef.current) return;
    const presetId = preset.id ?? preset.name;
    pendingRef.current = true;
    setPendingDeckId(presetId);
    try {
      const formatId = preset.format ?? "standard";
      const engine = resolveOfflineEngine();
      const opponents = await resolveOpponents(engine, formatId, opponentCount);
      if (!mountedRef.current) return;
      if (opponents.decks.length === 0) {
        toast.error("No AI deck available for this format — pick one yourself.");
        return;
      }
      const started = await useGameStore
        .getState()
        .startGame(
          preset,
          formatId,
          preset.commanders?.[0]?.identity.name,
          opponents.decks,
          engine,
        );
      if (!started) return;
      void reportPublishedDeckPlay(presetId, preset);
      savePresetToAccountOnUse(preset.id);
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
      if ((saved.deck.format ?? "standard") === "commander") {
        setPendingPod({ kind: "saved", savedDeckId });
        return;
      }
      await startSaved(savedDeckId, 1);
    },
    [startSaved],
  );

  const quickPlayPreset = useCallback(
    async (preset: PresetDeck) => {
      if (pendingRef.current) return;
      const formatId = preset.format ?? "standard";
      if (formatId === "oathbreaker" || getFormat(formatId) === undefined) {
        toast.error("This starter deck uses an unsupported format.");
        return;
      }
      if (!presetSupportsEngine(preset, resolveOfflineEngine())) {
        toast.error(
          `This deck is built for the ${preset.engines?.[0] ?? "Ironsmith"} engine — start a table with that engine from Multiplayer.`,
        );
        return;
      }
      if (formatId === "commander") {
        setPendingPod({ kind: "preset", preset });
        return;
      }
      await startPreset(preset, 1);
    },
    [startPreset],
  );

  const playersDialog: ReactNode = pendingPod ? (
    <PlaytestPlayersDialog
      open
      onChoose={(opponentCount) => {
        const pod = pendingPod;
        setPendingPod(null);
        if (pod.kind === "saved") void startSaved(pod.savedDeckId, opponentCount);
        else void startPreset(pod.preset, opponentCount);
      }}
      onCancel={() => setPendingPod(null)}
    />
  ) : null;

  return { quickPlay, quickPlayPreset, pendingDeckId, playersDialog };
}

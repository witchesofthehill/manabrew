import { create } from "zustand";

import type {
  BoosterDraftSetup,
  ChaosTheme,
  ConspiracyHook,
  CubeImportResult,
  DraftCard,
  DraftState,
  GauntletMatchDecks,
  GauntletOutcome,
  GauntletState,
  SealedPool,
  SealedSetup,
  SealedTemplateMetadata,
  WinstonSetup,
  WinstonState,
} from "@/types/limited";
import { fetchCubeMetadata } from "@/api/limitedEdition";
import { getPlatform } from "@/platform";
import { resolveSealedPool } from "@/lib/limited.utils";
import {
  commitLimitedEngineSession,
  restoreLimitedEngine,
  serializeLimitedSession,
} from "@/game/limitedPersistence";
import { readLimitedSave, flushLimitedStorage } from "@/game/limitedStorage";
import {
  configureDraftClock,
  draftDecisionRevision,
  exportDraftClock,
  restoreDraftClock,
  syncDraftClocks,
  publishDraftClocks,
  disposeDraftClock,
} from "@/game/limitedDraftClock";
import type { LimitedSessionKind, LimitedVisibleState } from "@/game/limitedPersistence.types";
import {
  useLimitedBuildStore,
  reconcileLimitedBuildPool,
} from "@/components/limited/useLimitedBuildStore";
import type { DraftClockSnapshot } from "@/game/limitedDraftClock";
import { peek as peekGauntletMatch, restoreGauntletProgress } from "@/lib/gauntletReturn";

const commandKinds: Record<string, LimitedSessionKind> = {
  limited_start_sealed: "sealed",
  limited_start_booster_draft: "draft",
  limited_pick_card: "draft",
  limited_auto_pick: "draft",
  limited_undo_pick: "draft",
  limited_start_winston: "winston",
  limited_winston_take: "winston",
  limited_winston_pass: "winston",
  limited_start_gauntlet_from_sealed: "gauntlet",
  limited_start_gauntlet_from_draft: "gauntlet",
  limited_record_gauntlet_outcome: "gauntlet",
  limited_advance_gauntlet_round: "gauntlet",
  limited_update_gauntlet_human_deck: "gauntlet",
};
const readKinds: Record<string, LimitedSessionKind> = {
  limited_get_sealed_pool: "sealed",
  limited_get_draft_state: "draft",
  limited_get_winston_state: "winston",
  limited_get_gauntlet_state: "gauntlet",
};

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
  decisionRevision?: number,
): Promise<T> {
  const platform = getPlatform();
  const kind = commandKinds[command];
  const requestedId = String(args?.gauntletId ?? args?.sessionId ?? "");
  if (!kind) {
    try {
      const result = await platform.invoke<T>(command, args);
      if (readKinds[command] === "draft" && !exportDraftClock(requestedId)) {
        const saved = await readLimitedSave(requestedId);
        if (saved?.role === "solo" && saved.clock) {
          configureSoloDraftClock(requestedId, undefined, saved.clock);
          syncDraftClocks(requestedId, [{ seat: 0, state: result as DraftState }]);
          await publishDraftClocks(requestedId);
        }
      }
      return result;
    } catch (error) {
      const kind = readKinds[command];
      const saved = requestedId ? await readLimitedSave(requestedId) : null;
      if (!kind || !saved) throw error;
      return serializeLimitedSession(requestedId, async () => {
        await restoreLimitedEngine(requestedId, kind);
        const restored = await platform.invoke<T>(command, args);
        if (kind === "draft" && saved.role === "solo" && saved.clock) {
          configureSoloDraftClock(requestedId, undefined, saved.clock);
          syncDraftClocks(requestedId, [{ seat: 0, state: restored as DraftState }]);
          await publishDraftClocks(requestedId);
        }
        if (kind === "gauntlet" && saved.gauntletProgress)
          await restoreGauntletProgress(requestedId, saved.gauntletProgress);
        return restored;
      });
    }
  }
  return serializeLimitedSession(requestedId || "solo-start", async () => {
    const starting = command.startsWith("limited_start_");
    const previous = starting ? null : await readLimitedSave(requestedId);
    let committed = false;
    const match = command === "limited_record_gauntlet_outcome" ? peekGauntletMatch() : null;
    const resultRequest =
      match?.gauntletId === requestedId ? `result:${match.round}:${match.totalGames}` : null;
    if (
      resultRequest &&
      previous?.acceptedRequests?.includes(resultRequest) &&
      previous.gauntletOutcome
    )
      return previous.gauntletOutcome as T;
    if (command === "limited_pick_card") {
      const current = await platform.invoke<DraftState>("limited_get_draft_state", {
        sessionId: requestedId,
      });
      if (!current?.awaitingHuman || current.revision !== decisionRevision)
        throw new Error("This pick is no longer current. Choose from the updated pack.");
    }
    try {
      if (command === "limited_auto_pick") {
        const current = await platform.invoke<DraftState>("limited_get_draft_state", {
          sessionId: requestedId,
        });
        const clock = exportDraftClock(requestedId);
        if (
          args?.revision &&
          (!clock ||
            clock.paused ||
            (args.clockSequence !== undefined && args.clockSequence !== clock.sequence))
        )
          return current as T;
        if (args?.revision && (!current || draftDecisionRevision(current) !== args.revision))
          return current as T;
        const pending = useLimitedBuildStore.getState().pendingPicks[requestedId];
        if (pending) useLimitedBuildStore.getState().cancelPick(requestedId, pending.id);
        if (args?.revision)
          args = {
            ...args,
            cardId: clock?.seats.find((entry) => entry.seat === 0)?.nominatedId ?? undefined,
          };
      }
      const result = await platform.invoke<T>(command, args);
      const state = (
        command === "limited_record_gauntlet_outcome" ? (result as GauntletOutcome).state : result
      ) as LimitedVisibleState;
      const sessionId =
        kind === "gauntlet"
          ? (state as GauntletState).gauntletId
          : (state as DraftState | WinstonState | SealedPool).sessionId;
      if (kind === "draft") {
        const setup = args?.setup as BoosterDraftSetup | undefined;
        const activeDraft = useLimitedStore.getState().activeDraft;
        if (starting && activeDraft && activeDraft.sessionId !== sessionId)
          disposeDraftClock(activeDraft.sessionId);
        if (starting && setup?.pickSeconds) configureSoloDraftClock(sessionId, setup.pickSeconds);
        syncDraftClocks(sessionId, [{ seat: 0, state: state as DraftState }]);
      }
      const sourceSetup = args?.setup as Record<string, unknown> | undefined;
      const importedCube = useLimitedStore.getState().lastImportedCube;
      const sourceCube =
        sourceSetup?.pool && importedCube?.pool === sourceSetup.pool ? importedCube : null;
      await commitLimitedEngineSession(kind, sessionId, state, {
        ...(starting
          ? {
              setup: sourceCube
                ? {
                    ...sourceSetup,
                    sourceKind: "cube",
                    cubeId: sourceCube.cubeId,
                    cubeName: sourceCube.name,
                  }
                : sourceSetup,
              sourceSessionId: args?.sessionId as string | undefined,
            }
          : {}),
        ...(command === "limited_undo_pick" && useLimitedBuildStore.getState().sessions[sessionId]
          ? {
              build: reconcileLimitedBuildPool(
                useLimitedBuildStore.getState().sessions[sessionId],
                (state as DraftState).pickedPile,
              ),
            }
          : {}),
        ...(resultRequest
          ? {
              acceptedRequests: [...(previous?.acceptedRequests ?? []), resultRequest],
              gauntletOutcome: result as GauntletOutcome,
            }
          : {}),
      });
      committed = true;
      if (kind === "draft") await publishDraftClocks(sessionId);
      return result;
    } catch (error) {
      if (!committed && previous?.checkpoint) {
        await platform.invoke("limited_import_session", { checkpoint: previous.checkpoint });
        if (kind === "draft" && previous.clock) {
          configureSoloDraftClock(requestedId, undefined, previous.clock);
          syncDraftClocks(requestedId, [{ seat: 0, state: previous.state as DraftState }]);
          await publishDraftClocks(requestedId);
        }
      }
      throw error;
    }
  });
}

interface LimitedStore {
  activeSealed: SealedPool | null;
  activeDraft: DraftState | null;
  activeWinston: WinstonState | null;
  sealedTemplates: SealedTemplateMetadata[];
  chaosThemes: ChaosTheme[];
  lastImportedCube: CubeImportResult | null;
  isStarting: boolean;
  lastError: string | null;

  startSealed: (setup: SealedSetup) => Promise<SealedPool>;
  refreshSealedPool: (sessionId: string) => Promise<void>;
  fetchSealedTemplates: () => Promise<void>;

  startBoosterDraft: (setup: BoosterDraftSetup) => Promise<DraftState>;
  pickDraftCard: (
    sessionId: string,
    card: DraftCard,
    decisionRevision: number,
  ) => Promise<DraftState>;
  undoDraftPick: (sessionId: string) => Promise<DraftState>;
  autoPickDraftCard: (
    sessionId: string,
    cardId?: string,
    revision?: string,
    clockSequence?: number,
  ) => Promise<DraftState>;
  refreshDraftState: (sessionId: string) => Promise<void>;

  startWinston: (setup: WinstonSetup) => Promise<WinstonState>;
  winstonTake: (sessionId: string) => Promise<WinstonState>;
  winstonPass: (sessionId: string) => Promise<WinstonState>;
  refreshWinstonState: (sessionId: string) => Promise<void>;

  fetchChaosThemes: () => Promise<void>;
  importCubeFromCubeCobra: (cubeIdOrUrl: string) => Promise<CubeImportResult>;

  activeGauntlet: GauntletState | null;
  conspiracyHooks: ConspiracyHook[];
  startGauntletFromSealed: (
    sessionId: string,
    rounds: number,
    main: DraftCard[],
    sideboard: DraftCard[],
  ) => Promise<GauntletState>;
  startGauntletFromDraft: (
    sessionId: string,
    rounds: number,
    main: DraftCard[],
    sideboard: DraftCard[],
  ) => Promise<GauntletState>;
  recordGauntletOutcome: (
    gauntletId: string,
    wonGame: boolean,
    matchOver: boolean,
    matchWon: boolean,
  ) => Promise<GauntletOutcome>;
  advanceGauntletRound: (gauntletId: string) => Promise<GauntletState>;
  refreshGauntletState: (gauntletId: string) => Promise<void>;
  fetchGauntletMatchDecks: (gauntletId: string) => Promise<GauntletMatchDecks>;
  updateGauntletHumanDeck: (
    gauntletId: string,
    main: DraftCard[],
    sideboard: DraftCard[],
  ) => Promise<GauntletState>;
  fetchConspiracyHooks: () => Promise<void>;

  clearActive: () => void;
}

export const useLimitedStore = create<LimitedStore>((set) => ({
  activeSealed: null,
  activeDraft: null,
  activeWinston: null,
  activeGauntlet: null,
  conspiracyHooks: [],
  sealedTemplates: [],
  chaosThemes: [],
  lastImportedCube: null,
  isStarting: false,
  lastError: null,

  startSealed: async (setup) => {
    set({ isStarting: true, lastError: null });
    try {
      const pool = await resolveSealedPool(
        await invoke<SealedPool>("limited_start_sealed", { setup }),
      );
      set({ activeSealed: pool, isStarting: false });
      return pool;
    } catch (err) {
      const msg = String(err);
      set({ isStarting: false, lastError: msg });
      throw new Error(msg);
    }
  },

  refreshSealedPool: async (sessionId) => {
    try {
      const pool = await resolveSealedPool(
        await invoke<SealedPool>("limited_get_sealed_pool", {
          sessionId,
        }),
      );
      set({ activeSealed: pool, lastError: null });
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  fetchSealedTemplates: async () => {
    try {
      const templates = await invoke<SealedTemplateMetadata[]>("limited_list_sealed_templates");
      set({ sealedTemplates: templates });
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  startBoosterDraft: async (setup) => {
    set({ isStarting: true, lastError: null });
    try {
      const state = await invoke<DraftState>("limited_start_booster_draft", { setup });
      set({ activeDraft: state, isStarting: false });
      return state;
    } catch (err) {
      const msg = String(err);
      set({ isStarting: false, lastError: msg });
      throw new Error(msg);
    }
  },

  pickDraftCard: async (sessionId, card, decisionRevision) => {
    try {
      const state = await invoke<DraftState>(
        "limited_pick_card",
        {
          sessionId,
          cardId: card.id,
        },
        decisionRevision,
      );
      set({ activeDraft: state, lastError: null });
      return state;
    } catch (err) {
      const msg = String(err);
      set({ lastError: msg });
      throw new Error(msg);
    }
  },
  autoPickDraftCard: async (sessionId, cardId, revision, clockSequence) => {
    const state = await invoke<DraftState>("limited_auto_pick", {
      sessionId,
      cardId,
      revision,
      clockSequence,
    });
    set({ activeDraft: state, lastError: null });
    return state;
  },

  undoDraftPick: async (sessionId) => {
    try {
      const state = await invoke<DraftState>("limited_undo_pick", { sessionId });
      useLimitedBuildStore.getState().reconcilePool(sessionId, state.pickedPile);
      await flushLimitedStorage();
      set({ activeDraft: state, lastError: null });
      return state;
    } catch (err) {
      const msg = String(err);
      set({ lastError: msg });
      throw new Error(msg);
    }
  },

  refreshDraftState: async (sessionId) => {
    try {
      const state = await invoke<DraftState>("limited_get_draft_state", {
        sessionId,
      });
      set({ activeDraft: state, lastError: null });
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  startWinston: async (setup) => {
    set({ isStarting: true, lastError: null });
    try {
      const state = await invoke<WinstonState>("limited_start_winston", { setup });
      set({ activeWinston: state, isStarting: false });
      return state;
    } catch (err) {
      const msg = String(err);
      set({ isStarting: false, lastError: msg });
      throw new Error(msg);
    }
  },

  winstonTake: async (sessionId) => {
    try {
      const state = await invoke<WinstonState>("limited_winston_take", { sessionId });
      set({ activeWinston: state, lastError: null });
      return state;
    } catch (err) {
      const msg = String(err);
      set({ lastError: msg });
      throw new Error(msg);
    }
  },

  winstonPass: async (sessionId) => {
    try {
      const state = await invoke<WinstonState>("limited_winston_pass", { sessionId });
      set({ activeWinston: state, lastError: null });
      return state;
    } catch (err) {
      const msg = String(err);
      set({ lastError: msg });
      throw new Error(msg);
    }
  },

  refreshWinstonState: async (sessionId) => {
    try {
      const state = await invoke<WinstonState>("limited_get_winston_state", { sessionId });
      set({ activeWinston: state, lastError: null });
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  fetchChaosThemes: async () => {
    try {
      const themes = await invoke<ChaosTheme[]>("limited_list_chaos_themes");
      set({ chaosThemes: themes });
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  importCubeFromCubeCobra: async (cubeIdOrUrl) => {
    set({ isStarting: true, lastError: null });
    try {
      const result = await fetchCubeMetadata(cubeIdOrUrl);
      set({ lastImportedCube: result, isStarting: false });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ isStarting: false, lastError: msg });
      throw err;
    }
  },

  startGauntletFromSealed: async (sessionId, rounds, main, sideboard) => {
    set({ isStarting: true, lastError: null });
    try {
      const state = await invoke<GauntletState>("limited_start_gauntlet_from_sealed", {
        sessionId,
        rounds,
        main,
        sideboard,
      });
      set({ activeGauntlet: state, isStarting: false });
      return state;
    } catch (err) {
      const msg = String(err);
      set({ isStarting: false, lastError: msg });
      throw new Error(msg);
    }
  },

  startGauntletFromDraft: async (sessionId, rounds, main, sideboard) => {
    set({ isStarting: true, lastError: null });
    try {
      const state = await invoke<GauntletState>("limited_start_gauntlet_from_draft", {
        sessionId,
        rounds,
        main,
        sideboard,
      });
      set({ activeGauntlet: state, isStarting: false });
      return state;
    } catch (err) {
      const msg = String(err);
      set({ isStarting: false, lastError: msg });
      throw new Error(msg);
    }
  },

  recordGauntletOutcome: async (gauntletId, wonGame, matchOver, matchWon) => {
    try {
      const out = await invoke<GauntletOutcome>("limited_record_gauntlet_outcome", {
        gauntletId,
        wonGame,
        matchOver,
        matchWon,
      });
      set({ activeGauntlet: out.state, lastError: null });
      return out;
    } catch (err) {
      const msg = String(err);
      set({ lastError: msg });
      throw new Error(msg);
    }
  },

  advanceGauntletRound: async (gauntletId) => {
    try {
      const state = await invoke<GauntletState>("limited_advance_gauntlet_round", { gauntletId });
      set({ activeGauntlet: state, lastError: null });
      return state;
    } catch (err) {
      const msg = String(err);
      set({ lastError: msg });
      throw new Error(msg);
    }
  },

  refreshGauntletState: async (gauntletId) => {
    try {
      const state = await invoke<GauntletState>("limited_get_gauntlet_state", { gauntletId });
      set({ activeGauntlet: state, lastError: null });
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  fetchGauntletMatchDecks: async (gauntletId) => {
    return invoke<GauntletMatchDecks>("limited_get_gauntlet_match_decks", { gauntletId });
  },

  updateGauntletHumanDeck: async (gauntletId, main, sideboard) => {
    const state = await invoke<GauntletState>("limited_update_gauntlet_human_deck", {
      gauntletId,
      main,
      sideboard,
    });
    set({ activeGauntlet: state, lastError: null });
    return state;
  },

  fetchConspiracyHooks: async () => {
    try {
      const hooks = await invoke<ConspiracyHook[]>("limited_list_conspiracy_hooks");
      set({ conspiracyHooks: hooks });
    } catch (err) {
      set({ lastError: String(err) });
    }
  },

  clearActive: () => {
    const draft = useLimitedStore.getState().activeDraft;
    if (draft) disposeDraftClock(draft.sessionId);
    set({
      activeSealed: null,
      activeDraft: null,
      activeWinston: null,
      activeGauntlet: null,
    });
  },
}));

export function configureSoloDraftClock(
  sessionId: string,
  pickSeconds?: number,
  snapshot?: DraftClockSnapshot,
): void {
  const options = {
    sessionId,
    pickSeconds,
    enqueue: <T>(operation: () => Promise<T>) => serializeLimitedSession(sessionId, operation),
    onTimeout: async (_seat: number, revision: string, cardId?: string, clockSequence?: number) => {
      await useLimitedStore
        .getState()
        .autoPickDraftCard(sessionId, cardId, revision, clockSequence);
    },
    onChange: async () => {
      const current = useLimitedStore.getState().activeDraft;
      if (!current || current.sessionId !== sessionId)
        throw new Error("This solo draft is no longer active.");
      await commitLimitedEngineSession("draft", sessionId, current);
    },
  };
  if (snapshot) restoreDraftClock(snapshot, options);
  else configureDraftClock(options);
}

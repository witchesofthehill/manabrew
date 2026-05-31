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

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return getPlatform().invoke<T>(command, args);
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
  pickDraftCard: (sessionId: string, cardName: string) => Promise<DraftState>;
  undoDraftPick: (sessionId: string) => Promise<DraftState>;
  refreshDraftState: (sessionId: string) => Promise<void>;

  startWinston: (setup: WinstonSetup) => Promise<WinstonState>;
  winstonTake: (sessionId: string) => Promise<WinstonState>;
  winstonPass: (sessionId: string) => Promise<WinstonState>;
  refreshWinstonState: (sessionId: string) => Promise<void>;

  fetchChaosThemes: () => Promise<void>;
  importCubeFromCubeCobra: (cubeIdOrUrl: string) => Promise<CubeImportResult>;

  activeGauntlet: GauntletState | null;
  conspiracyHooks: ConspiracyHook[];
  startGauntletFromSealed: (sessionId: string, rounds: number) => Promise<GauntletState>;
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
      const pool = await invoke<SealedPool>("limited_start_sealed", { setup });
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
      const pool = await invoke<SealedPool>("limited_get_sealed_pool", {
        sessionId,
      });
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

  pickDraftCard: async (sessionId, cardName) => {
    try {
      const state = await invoke<DraftState>("limited_pick_card", {
        sessionId,
        cardName,
      });
      set({ activeDraft: state, lastError: null });
      return state;
    } catch (err) {
      const msg = String(err);
      set({ lastError: msg });
      throw new Error(msg);
    }
  },

  undoDraftPick: async (sessionId) => {
    try {
      const state = await invoke<DraftState>("limited_undo_pick", { sessionId });
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

  startGauntletFromSealed: async (sessionId, rounds) => {
    set({ isStarting: true, lastError: null });
    try {
      const state = await invoke<GauntletState>("limited_start_gauntlet_from_sealed", {
        sessionId,
        rounds,
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

  clearActive: () =>
    set({
      activeSealed: null,
      activeDraft: null,
      activeWinston: null,
      activeGauntlet: null,
    }),
}));

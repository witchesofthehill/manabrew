import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { getServerConnectionDefaults } from "@/config/webRuntimeConfig";
import { STORAGE_KEYS } from "@/lib/constants";
import { ensureUsernameTag, hasUsernameTag } from "@/lib/username";
import type { AiOpponentRef } from "@/lib/aiOpponent";
import type { KnownRelay } from "@/config/knownRelays";
import type { PlaymatSettings } from "@/protocol/game";
import type { EngineKind, GameFormat } from "@/types/server";

export type ZonePanelItem = "library" | "graveyard" | "exile";
export type CardPreviewMode = "hover" | "shift" | "alt" | "ctrl";
export type BattlefieldCardStyle = "realistic" | "art" | "frame";

export interface LastRoomSetup {
  kind: "match" | "limited";
  limitedKind: "draft" | "sealed" | "winston" | "cube";
  format: GameFormat;
  engine: EngineKind;
  players: number | null;
}

export const CARD_SIZE_MULTIPLIER_MIN = 0.75;
// Under the 2-rows-minimum battlefield rule, a 2-row fill is only ~1.35-1.5x
// the classic 3-row size on ANY display — a knob past 150% would be a lie
// (the old 300% top was one: everything saturated around 150%).
export const CARD_SIZE_MULTIPLIER_MAX = 1.5;

interface PreferencesState {
  appThemePreset: string;
  setAppThemePreset: (id: string) => void;

  flashDurationMs: number;
  setFlashDurationMs: (ms: number) => void;

  serverHost: string;
  serverPort: number;
  serverUsername: string;
  serverPassword: string;
  setServerHost: (host: string) => void;
  setServerPort: (port: number) => void;
  setServerUsername: (username: string) => void;
  setServerPassword: (password: string) => void;

  savedServers: KnownRelay[];
  addSavedServer: (server: KnownRelay) => void;
  removeSavedServer: (name: string) => void;

  customAvatarUrl?: string;
  customAvatarAssetId?: string;
  setCustomAvatar: (url: string | undefined, assetId: string | undefined) => void;

  defaultPlaymatUrl?: string;
  defaultPlaymatAssetId?: string;
  defaultPlaymatSettings?: PlaymatSettings;
  setDefaultPlaymat: (url: string | undefined, assetId: string | undefined) => void;
  setDefaultPlaymatSettings: (settings: PlaymatSettings | undefined) => void;

  zonePanelOrder: ZonePanelItem[];
  setZonePanelOrder: (order: ZonePanelItem[]) => void;

  battlefieldAutoSort: boolean;
  setBattlefieldAutoSort: (value: boolean) => void;

  // One knob for card size: battlefield cards on ALL fields plus the hand
  // fan. 1 = the classic 3-row board; 1.5 = the 2-row fill that is the
  // geometric max under the 2-rows-minimum rule (a 1-row board is
  // unplayable). Each field clamps against its own height; the hand
  // (viewport-scaled, following the slider at half rate — useHandScale)
  // grows past the battlefield's cap, up to a fraction of the field height
  // (BoardCanvas.reconfigure).
  cardSizeMultiplier: number;
  setCardSizeMultiplier: (multiplier: number) => void;

  // Freezes the deck/graveyard/exile/command tiles in place so a drag can't
  // accidentally reposition them; tap-to-open keeps working.
  lockZoneTiles: boolean;
  setLockZoneTiles: (value: boolean) => void;

  // Only the Pixi battlefield reads this; hand, stack, and modals always use
  // the image.
  battlefieldCardStyle: BattlefieldCardStyle;
  setBattlefieldCardStyle: (style: BattlefieldCardStyle) => void;

  // Perf escape hatch for weaker hardware; the board still functions when off
  // (cards move, state indicators stay).
  inGameAnimations: boolean;
  setInGameAnimations: (value: boolean) => void;

  chooseOrderOnMultipleTriggers: boolean;
  setChooseOrderOnMultipleTriggers: (value: boolean) => void;

  // Opt-in for the experimental Ironsmith trusted engine. Off by default so the
  // engine ships dark in prod; the runtime registry and lobby tile also gate on
  // the compile flag + `IRONSMITH_WASM_AVAILABLE`, so this only surfaces it
  // where the real wasm is bundled.
  ironsmithRuntimeEnabled: boolean;
  setIronsmithRuntimeEnabled: (value: boolean) => void;

  askEngineOnAiPlay: boolean;
  setAskEngineOnAiPlay: (value: boolean) => void;

  hideAccountSaveNudge: boolean;
  setHideAccountSaveNudge: (value: boolean) => void;

  cardPreviewMode: CardPreviewMode;
  setCardPreviewMode: (mode: CardPreviewMode) => void;

  cardHoverDelayMs: number;
  setCardHoverDelayMs: (ms: number) => void;

  appThemeColorOverrides: Record<string, string>;
  setAppThemeColorOverride: (key: string, hsl: string) => void;
  resetAppThemeColorOverrides: () => void;

  gameThemeColorOverrides: Record<string, string>;
  setGameThemeColorOverride: (path: string, color: string) => void;
  resetGameThemeColorOverrides: () => void;

  lastPlayedDeckId: string | null;
  lastPlayedAtByDeck: Record<string, number>;
  setLastPlayedDeckId: (id: string | null) => void;

  lastOfflineEngine: EngineKind | null;
  setLastOfflineEngine: (engine: EngineKind) => void;

  lastOfflineFormatId: string | null;
  setLastOfflineFormatId: (formatId: string) => void;

  lastAiOpponent: AiOpponentRef | null;
  setLastAiOpponent: (opponent: AiOpponentRef) => void;

  lastRoomSetup: LastRoomSetup | null;
  setLastRoomSetup: (setup: LastRoomSetup) => void;
}

const PERSISTED_PREFERENCE_KEYS = [
  "appThemePreset",
  "flashDurationMs",
  "serverHost",
  "serverPort",
  "serverUsername",
  "serverPassword",
  "savedServers",
  "customAvatarUrl",
  "customAvatarAssetId",
  "defaultPlaymatUrl",
  "defaultPlaymatAssetId",
  "defaultPlaymatSettings",
  "zonePanelOrder",
  "battlefieldAutoSort",
  "cardSizeMultiplier",
  "lockZoneTiles",
  "battlefieldCardStyle",
  "inGameAnimations",
  "chooseOrderOnMultipleTriggers",
  "ironsmithRuntimeEnabled",
  "askEngineOnAiPlay",
  "hideAccountSaveNudge",
  "cardPreviewMode",
  "cardHoverDelayMs",
  "appThemeColorOverrides",
  "gameThemeColorOverrides",
  "lastPlayedDeckId",
  "lastPlayedAtByDeck",
  "lastOfflineEngine",
  "lastOfflineFormatId",
  "lastAiOpponent",
  "lastRoomSetup",
] as const satisfies readonly (keyof PreferencesState)[];

function pickPersistedPreferences(persistedState: unknown): Partial<PreferencesState> {
  if (!persistedState || typeof persistedState !== "object") return {};
  const persisted = persistedState as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const key of PERSISTED_PREFERENCE_KEYS) {
    if (key in persisted) next[key] = persisted[key];
  }
  // Treat a persisted empty username as "unset" so the auto-generated default
  // wins on rehydrate. Without this, users who once had the empty default
  // saved would never get a generated name.
  if (next.serverUsername === "") delete next.serverUsername;
  // Values saved while the slider still went to 300% clamp to the new max.
  if (typeof next.cardSizeMultiplier === "number") {
    next.cardSizeMultiplier = Math.max(
      CARD_SIZE_MULTIPLIER_MIN,
      Math.min(CARD_SIZE_MULTIPLIER_MAX, next.cardSizeMultiplier),
    );
  }
  return next as Partial<PreferencesState>;
}

function generateGuestUsername(): string {
  return `player-${Math.random().toString(36).slice(2, 8)}`;
}

export const usePreferencesStore = create<PreferencesState>()(
  devtools(
    persist(
      (set) => {
        const serverDefaults = getServerConnectionDefaults();
        return {
          appThemePreset: "default",
          setAppThemePreset: (appThemePreset) =>
            set({ appThemePreset, appThemeColorOverrides: {}, gameThemeColorOverrides: {} }),

          flashDurationMs: 1000,
          setFlashDurationMs: (ms) => set({ flashDurationMs: ms }),

          serverHost: serverDefaults.host,
          serverPort: serverDefaults.port,
          serverUsername: ensureUsernameTag(serverDefaults.username || generateGuestUsername()),
          serverPassword: serverDefaults.password,
          setServerHost: (serverHost) => set({ serverHost }),
          setServerPort: (serverPort) => set({ serverPort }),
          setServerUsername: (serverUsername) =>
            set((state) => ({
              serverUsername: ensureUsernameTag(serverUsername, state.serverUsername),
            })),
          setServerPassword: (serverPassword) => set({ serverPassword }),

          savedServers: [],
          addSavedServer: (server) =>
            set((state) => ({
              savedServers: [...state.savedServers.filter((s) => s.name !== server.name), server],
            })),
          removeSavedServer: (name) =>
            set((state) => ({
              savedServers: state.savedServers.filter((s) => s.name !== name),
            })),

          customAvatarUrl: undefined,
          customAvatarAssetId: undefined,
          setCustomAvatar: (customAvatarUrl, customAvatarAssetId) =>
            set({ customAvatarUrl, customAvatarAssetId }),

          defaultPlaymatUrl: undefined,
          defaultPlaymatAssetId: undefined,
          defaultPlaymatSettings: undefined,
          setDefaultPlaymat: (defaultPlaymatUrl, defaultPlaymatAssetId) =>
            set({ defaultPlaymatUrl, defaultPlaymatAssetId }),
          setDefaultPlaymatSettings: (defaultPlaymatSettings) => set({ defaultPlaymatSettings }),

          zonePanelOrder: ["library", "graveyard", "exile"],
          setZonePanelOrder: (zonePanelOrder) => set({ zonePanelOrder }),

          battlefieldAutoSort: false,
          setBattlefieldAutoSort: (battlefieldAutoSort) => set({ battlefieldAutoSort }),

          cardSizeMultiplier: 1,
          setCardSizeMultiplier: (cardSizeMultiplier) =>
            set({
              cardSizeMultiplier: Math.max(
                CARD_SIZE_MULTIPLIER_MIN,
                Math.min(CARD_SIZE_MULTIPLIER_MAX, cardSizeMultiplier),
              ),
            }),

          lockZoneTiles: false,
          setLockZoneTiles: (lockZoneTiles) => set({ lockZoneTiles }),

          battlefieldCardStyle: "realistic",
          setBattlefieldCardStyle: (battlefieldCardStyle) => set({ battlefieldCardStyle }),

          inGameAnimations: true,
          setInGameAnimations: (inGameAnimations) => set({ inGameAnimations }),

          chooseOrderOnMultipleTriggers: true,
          setChooseOrderOnMultipleTriggers: (chooseOrderOnMultipleTriggers) =>
            set({ chooseOrderOnMultipleTriggers }),

          ironsmithRuntimeEnabled: false,
          setIronsmithRuntimeEnabled: (ironsmithRuntimeEnabled) => set({ ironsmithRuntimeEnabled }),

          askEngineOnAiPlay: false,
          setAskEngineOnAiPlay: (askEngineOnAiPlay) => set({ askEngineOnAiPlay }),

          hideAccountSaveNudge: false,
          setHideAccountSaveNudge: (hideAccountSaveNudge) => set({ hideAccountSaveNudge }),

          cardPreviewMode: "hover",
          setCardPreviewMode: (cardPreviewMode) => set({ cardPreviewMode }),

          cardHoverDelayMs: 350,
          setCardHoverDelayMs: (ms) => set({ cardHoverDelayMs: ms }),

          appThemeColorOverrides: {},
          setAppThemeColorOverride: (key, hsl) =>
            set((state) => ({
              appThemeColorOverrides: { ...state.appThemeColorOverrides, [key]: hsl },
            })),
          resetAppThemeColorOverrides: () => set({ appThemeColorOverrides: {} }),

          gameThemeColorOverrides: {},
          setGameThemeColorOverride: (path, color) =>
            set((state) => ({
              gameThemeColorOverrides: {
                ...state.gameThemeColorOverrides,
                [path]: color,
              },
            })),
          resetGameThemeColorOverrides: () => set({ gameThemeColorOverrides: {} }),

          lastPlayedDeckId: null,
          lastPlayedAtByDeck: {},
          setLastPlayedDeckId: (lastPlayedDeckId) =>
            set((state) => ({
              lastPlayedDeckId,
              lastPlayedAtByDeck: lastPlayedDeckId
                ? { ...state.lastPlayedAtByDeck, [lastPlayedDeckId]: Date.now() }
                : state.lastPlayedAtByDeck,
            })),

          lastOfflineEngine: null,
          setLastOfflineEngine: (lastOfflineEngine) => set({ lastOfflineEngine }),

          lastOfflineFormatId: null,
          setLastOfflineFormatId: (lastOfflineFormatId) => set({ lastOfflineFormatId }),

          lastAiOpponent: null,
          setLastAiOpponent: (lastAiOpponent) => set({ lastAiOpponent }),

          lastRoomSetup: null,
          setLastRoomSetup: (lastRoomSetup) => set({ lastRoomSetup }),
        };
      },
      {
        name: STORAGE_KEYS.PREFERENCES,
        version: 1,
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...pickPersistedPreferences(persistedState),
        }),
        // Usernames persisted before the @NNNN tag scheme get tagged once on
        // load, through the setter so the tagged name is written back and
        // stays stable across refreshes.
        onRehydrateStorage: () => (state) => {
          if (state && state.serverUsername && !hasUsernameTag(state.serverUsername)) {
            state.setServerUsername(state.serverUsername);
          }
        },
      },
    ),
    { name: "preferences", enabled: import.meta.env.DEV },
  ),
);

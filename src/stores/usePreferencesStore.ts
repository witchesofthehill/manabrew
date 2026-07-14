import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { getServerConnectionDefaults } from "@/config/webRuntimeConfig";
import { STORAGE_KEYS } from "@/lib/constants";
import { ensureUsernameTag, hasUsernameTag } from "@/lib/username";
import type { KnownRelay } from "@/config/knownRelays";
import type { PlaymatSettings } from "@/protocol/game";

export type ZonePanelItem = "library" | "graveyard" | "exile";
export type CardPreviewMode = "hover" | "shift" | "alt" | "ctrl";
export type BattlefieldCardStyle = "realistic" | "art" | "frame";

export const CARD_SIZE_MULTIPLIER_MIN = 0.75;
export const CARD_SIZE_MULTIPLIER_MAX = 3;

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

  customAvatar?: string;
  setCustomAvatar: (dataUrl: string | undefined) => void;

  defaultPlaymat?: string;
  defaultPlaymatSettings?: PlaymatSettings;
  setDefaultPlaymat: (dataUrl: string | undefined) => void;
  setDefaultPlaymatSettings: (settings: PlaymatSettings | undefined) => void;

  zonePanelOrder: ZonePanelItem[];
  setZonePanelOrder: (order: ZonePanelItem[]) => void;

  battlefieldAutoSort: boolean;
  setBattlefieldAutoSort: (value: boolean) => void;

  // One knob for battlefield card size on ALL fields. 1 = the classic 3-row
  // board; 3 = 300%. Each field clamps to a 2-row fill of its own height (a
  // 1-row board is unplayable), so on small windows large multipliers
  // saturate early. The hand keeps its classic size and only grows past it on
  // displays tall enough for battlefield cards to outgrow it
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
}

const PERSISTED_PREFERENCE_KEYS = [
  "appThemePreset",
  "flashDurationMs",
  "serverHost",
  "serverPort",
  "serverUsername",
  "serverPassword",
  "savedServers",
  "customAvatar",
  "defaultPlaymat",
  "defaultPlaymatSettings",
  "zonePanelOrder",
  "battlefieldAutoSort",
  "cardSizeMultiplier",
  "lockZoneTiles",
  "battlefieldCardStyle",
  "inGameAnimations",
  "cardPreviewMode",
  "cardHoverDelayMs",
  "appThemeColorOverrides",
  "gameThemeColorOverrides",
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

          customAvatar: undefined,
          setCustomAvatar: (customAvatar) => set({ customAvatar }),

          defaultPlaymat: undefined,
          defaultPlaymatSettings: undefined,
          setDefaultPlaymat: (defaultPlaymat) => set({ defaultPlaymat }),
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

          cardPreviewMode: "hover",
          setCardPreviewMode: (cardPreviewMode) => set({ cardPreviewMode }),

          cardHoverDelayMs: 500,
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

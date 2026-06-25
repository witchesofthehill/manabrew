import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { getServerConnectionDefaults } from "@/config/webRuntimeConfig";
import { STORAGE_KEYS } from "@/lib/constants";
import type { PlaymatSettings } from "@/protocol/game";

export type ZonePanelItem = "library" | "graveyard" | "exile";
export type CardPreviewMode = "hover" | "shift" | "alt" | "ctrl";
export type BattlefieldCardStyle = "realistic" | "art" | "frame";

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

  battlefieldCardScale: number;
  setBattlefieldCardScale: (fraction: number) => void;

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
  "customAvatar",
  "defaultPlaymat",
  "defaultPlaymatSettings",
  "zonePanelOrder",
  "battlefieldAutoSort",
  "battlefieldCardScale",
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
          serverUsername: serverDefaults.username || generateGuestUsername(),
          serverPassword: serverDefaults.password,
          setServerHost: (serverHost) => set({ serverHost }),
          setServerPort: (serverPort) => set({ serverPort }),
          setServerUsername: (serverUsername) => set({ serverUsername }),
          setServerPassword: (serverPassword) => set({ serverPassword }),

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

          battlefieldCardScale: 0.5,
          setBattlefieldCardScale: (battlefieldCardScale) =>
            set({ battlefieldCardScale: Math.max(0, Math.min(1, battlefieldCardScale)) }),

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
      },
    ),
    { name: "preferences", enabled: import.meta.env.DEV },
  ),
);

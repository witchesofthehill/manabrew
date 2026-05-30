import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { getServerConnectionDefaults } from "@/config/webRuntimeConfig";
import { STORAGE_KEYS } from "@/lib/constants";

export type ZonePanelItem = "library" | "graveyard" | "exile";
export type HandSize = "small" | "medium" | "large";
export type CardPreviewMode = "hover" | "shift" | "alt" | "ctrl";

interface PreferencesState {
  /** App color theme preset id */
  appThemePreset: string;
  setAppThemePreset: (id: string) => void;

  /** Duration of card-play and turn-start flash animations in ms */
  flashDurationMs: number;
  setFlashDurationMs: (ms: number) => void;

  /** Server connection defaults */
  serverHost: string;
  serverPort: number;
  serverUsername: string;
  serverPassword: string;
  setServerHost: (host: string) => void;
  setServerPort: (port: number) => void;
  setServerUsername: (username: string) => void;
  setServerPassword: (password: string) => void;

  /** Battlefield zone column order */
  zonePanelOrder: ZonePanelItem[];
  setZonePanelOrder: (order: ZonePanelItem[]) => void;

  /** Hand card size */
  handSize: HandSize;
  setHandSize: (size: HandSize) => void;

  /** Multiplier applied to battlefield card sprites and the grid cells they snap into. */
  battlefieldCardScale: number;
  setBattlefieldCardScale: (scale: number) => void;

  /** Card preview trigger mode */
  cardPreviewMode: CardPreviewMode;
  setCardPreviewMode: (mode: CardPreviewMode) => void;

  /** Card hover preview delay in ms */
  cardHoverDelayMs: number;
  setCardHoverDelayMs: (ms: number) => void;

  /** App theme color overrides (CSS variable name → HSL value) */
  appThemeColorOverrides: Record<string, string>;
  setAppThemeColorOverride: (key: string, hsl: string) => void;
  resetAppThemeColorOverrides: () => void;

  /** Game UI color overrides by dot-path key */
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
  "zonePanelOrder",
  "handSize",
  "battlefieldCardScale",
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

/** Stable per-browser guest handle. Generated once, persisted via zustand. */
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

          zonePanelOrder: ["library", "graveyard", "exile"],
          setZonePanelOrder: (zonePanelOrder) => set({ zonePanelOrder }),

          handSize: "medium",
          setHandSize: (handSize) => set({ handSize }),

          battlefieldCardScale: 1.15,
          setBattlefieldCardScale: (battlefieldCardScale) =>
            set({ battlefieldCardScale: Math.max(0.8, Math.min(1.8, battlefieldCardScale)) }),

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
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...pickPersistedPreferences(persistedState),
        }),
      },
    ),
    { name: "preferences", enabled: import.meta.env.DEV },
  ),
);

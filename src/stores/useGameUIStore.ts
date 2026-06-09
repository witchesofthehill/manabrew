import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { DeckCard, GameCard } from "@/types/manabrew";

// ── State Shapes ──────────────────────────────────────────────────────────────

export interface HandActionOption {
  kind: "cast" | "ability" | "manual-move" | "manual-tap";
  cardId: string;
  label: string;
  mode?: string;
  abilityIndex?: number;
  isManaAbility?: boolean;
  cost?: string;
  toZoneId?: string;
  tapped?: boolean;
}

export interface AbilityPickerState {
  cardId: string;
  card?: DeckCard;
  abilities: HandActionOption[];
}

interface PlayModePickerState {
  cardId: string;
  card: DeckCard;
  options: { cardId: string; mode: string; modeLabel: string }[];
}

interface ViewingZoneState {
  title: string;
  cards: GameCard[];
  onClickCard?: (cardId: string) => void;
  clickableCardIds?: string[];
}

// ── Store Interface ───────────────────────────────────────────────────────────

interface GameUIState {
  // Modal states (all transient, not persisted)
  abilityPicker: AbilityPickerState | null;
  playModePicker: PlayModePickerState | null;
  viewingZone: ViewingZoneState | null;
  isActionPanelCollapsed: boolean;
  promptModalHidden: boolean;

  // Actions
  openAbilityPicker: (state: AbilityPickerState) => void;
  closeAbilityPicker: () => void;
  openPlayModePicker: (state: PlayModePickerState) => void;
  closePlayModePicker: () => void;
  openZoneViewer: (state: ViewingZoneState) => void;
  closeZoneViewer: () => void;
  toggleActionPanel: () => void;
  setActionPanelCollapsed: (collapsed: boolean) => void;
  hidePromptModal: () => void;
  showPromptModal: () => void;
  resetAll: () => void;
}

// ── Store Implementation ──────────────────────────────────────────────────────

export const useGameUIStore = create<GameUIState>()(
  devtools(
    (set) => ({
      // Initial state
      abilityPicker: null,
      playModePicker: null,
      viewingZone: null,
      isActionPanelCollapsed: true,
      promptModalHidden: false,

      // Actions
      openAbilityPicker: (state) => set({ abilityPicker: state }),
      closeAbilityPicker: () => set({ abilityPicker: null }),

      openPlayModePicker: (state) => set({ playModePicker: state }),
      closePlayModePicker: () => set({ playModePicker: null }),

      openZoneViewer: (state) => set({ viewingZone: state }),
      closeZoneViewer: () => set({ viewingZone: null }),

      toggleActionPanel: () =>
        set((state) => ({ isActionPanelCollapsed: !state.isActionPanelCollapsed })),
      setActionPanelCollapsed: (collapsed) => set({ isActionPanelCollapsed: collapsed }),
      hidePromptModal: () => set({ promptModalHidden: true }),
      showPromptModal: () => set({ promptModalHidden: false }),

      resetAll: () =>
        set({
          abilityPicker: null,
          playModePicker: null,
          viewingZone: null,
          isActionPanelCollapsed: true,
          promptModalHidden: false,
        }),
    }),
    { name: "gameUI", enabled: import.meta.env.DEV },
  ),
);

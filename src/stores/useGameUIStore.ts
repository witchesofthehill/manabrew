import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import type { Prompt } from "@/protocol";
import type { ZoneLocation, ZoneViewMode } from "@/lib/zoneView";
import type { CardBrowserState } from "@/components/game/modals/cardBrowser";

export interface HandActionOption {
  kind: "cast" | "ability" | "manual-move" | "manual-tap";
  cardId: string;
  label: string;
  actionId?: string;
  mode?: string;
  abilityIndex?: number;
  isManaAbility?: boolean;
  isClassLevelUp?: boolean;
  cost?: string;
  displayManaLetters?: string[];
  colorChoice?: string;
  toZoneId?: string;
  tapped?: boolean;
}

export interface AbilityPickerState {
  cardId: string;
  card?: DeckCard;
  promptId: Prompt["promptId"];
  source: CardDto;
  abilities: HandActionOption[];
}

export interface PlayModePickerState {
  cardId: string;
  card: DeckCard;
  options: HandActionOption[];
  promptId: Prompt["promptId"];
  source: CardDto;
}

export interface ViewingZoneState {
  title: string;
  cards: CardDto[];
  mode: ZoneViewMode;
  source?: ZoneLocation;
  promptId?: number;
  onClickCard?: (cardId: string) => void;
  clickableCardIds?: string[];
  selectedCardIds?: string[];
  clickLabel?: string;
  selectedLabel?: string;
  /** Prompt type this viewer serves. While set, the viewer stays open across
   *  same-type re-prompts (e.g. picking the 2nd of N targets) and only closes
   *  once the active prompt changes type or ends. */
  stickyPromptType?: string;
  targetHostile?: boolean;
}

interface GameUIState {
  // Modal states (all transient, not persisted)
  abilityPicker: AbilityPickerState | null;
  playModePicker: PlayModePickerState | null;
  viewingZone: ViewingZoneState | null;
  isActionPanelCollapsed: boolean;
  rightPanelTab: "log" | "snapshots" | "dev";
  promptModalHidden: boolean;
  zoneBrowserStates: Record<string, CardBrowserState>;
  saveZoneBrowserState: (key: string, state: CardBrowserState) => void;

  openAbilityPicker: (state: AbilityPickerState) => void;
  closeAbilityPicker: () => void;
  openPlayModePicker: (state: PlayModePickerState) => void;
  closePlayModePicker: () => void;
  openZoneViewer: (state: ViewingZoneState) => void;
  closeZoneViewer: () => void;
  toggleActionPanel: () => void;
  setActionPanelCollapsed: (collapsed: boolean) => void;
  setRightPanelTab: (tab: "log" | "snapshots" | "dev") => void;
  toggleDevPanel: () => void;
  hidePromptModal: () => void;
  showPromptModal: () => void;
  resetAll: () => void;
}

export const useGameUIStore = create<GameUIState>()(
  devtools(
    (set) => ({
      abilityPicker: null,
      playModePicker: null,
      viewingZone: null,
      isActionPanelCollapsed: true,
      rightPanelTab: "log",
      promptModalHidden: false,
      zoneBrowserStates: {},
      saveZoneBrowserState: (key, state) =>
        set((current) => ({ zoneBrowserStates: { ...current.zoneBrowserStates, [key]: state } })),

      openAbilityPicker: (state) => set({ abilityPicker: state }),
      closeAbilityPicker: () => set({ abilityPicker: null }),

      openPlayModePicker: (state) => set({ playModePicker: state }),
      closePlayModePicker: () => set({ playModePicker: null }),

      openZoneViewer: (state) => set({ viewingZone: state }),
      closeZoneViewer: () => set({ viewingZone: null }),

      toggleActionPanel: () =>
        set((state) => ({ isActionPanelCollapsed: !state.isActionPanelCollapsed })),
      setActionPanelCollapsed: (collapsed) => set({ isActionPanelCollapsed: collapsed }),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
      toggleDevPanel: () => {
        if (!import.meta.env.DEV) return;
        set((state) =>
          state.rightPanelTab === "dev" && !state.isActionPanelCollapsed
            ? { isActionPanelCollapsed: true }
            : { isActionPanelCollapsed: false, rightPanelTab: "dev" },
        );
      },
      hidePromptModal: () => set({ promptModalHidden: true }),
      showPromptModal: () => set({ promptModalHidden: false }),

      resetAll: () =>
        set({
          abilityPicker: null,
          playModePicker: null,
          viewingZone: null,
          isActionPanelCollapsed: true,
          promptModalHidden: false,
          zoneBrowserStates: {},
        }),
    }),
    { name: "gameUI", enabled: import.meta.env.DEV },
  ),
);

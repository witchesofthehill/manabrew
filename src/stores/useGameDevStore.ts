import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { ArrowType } from "@/pixi/types";

export const DEBUG_KEYWORD_CARD_ID = "dev-keyword-card";

export const PROMPT_ACTION_VIEW_KEYS = [
  "chooseAction",
  "chooseAttackers",
  "chooseBlockers",
  "chooseDamageOrder",
  "chooseTargetSpell",
  "payManaCost",
  "promptRequired",
  "promptLabel",
  "passingUntilEot",
  "autoPassing",
  "noAction",
  "mulligan",
  "mulliganPutBack",
] as const;

export type PromptActionViewKey = (typeof PROMPT_ACTION_VIEW_KEYS)[number];

export const DEV_PROMPT_ACTION_OVERRIDES = [
  "chooseAction",
  "chooseAttackers",
  "chooseBlockers",
  "chooseTargetSpell",
  "payManaCost",
  "noAction",
] as const;

export type DevPromptActionOverride = (typeof DEV_PROMPT_ACTION_OVERRIDES)[number];

interface PixiPerfStats {
  fps: number;
  minFps: number;
  maxFps: number;
  deltaMs: number;
}

export interface DevPlayerOverrides {
  forceMonarch: boolean;
  forceInitiative: boolean;
  forceCityBlessing: boolean;
  poison: number | null;
  energy: number | null;
  radiation: number | null;
  ringLevel: number | null;
  speed: number | null;
  cmdDamage: number | null;
  life: number | null;
  handCount: number | null;
}

export const DEFAULT_DEV_PLAYER_OVERRIDES: DevPlayerOverrides = {
  forceMonarch: false,
  forceInitiative: false,
  forceCityBlessing: false,
  poison: null,
  energy: null,
  radiation: null,
  ringLevel: null,
  speed: null,
  cmdDamage: null,
  life: null,
  handCount: null,
};

export interface DevCardOverrides {
  forceTapped: boolean;
  forceSummoningSick: boolean;
  forceExerted: boolean;
  forceFaceDown: boolean;
  forceBestowed: boolean;
  forceTransformed: boolean;
  forcePlotted: boolean;
  forceMadnessExiled: boolean;
  forceWarpExiled: boolean;
  forceCopy: boolean;
  forceToken: boolean;
  forceFoil: boolean;
  forcePhasedOut: boolean;
  forceAttacking: boolean;
  forcePlayable: boolean;
  forceSelected: boolean;
  forceDoubleFaced: boolean;
  p1p1: number | null;
  m1m1: number | null;
  loyalty: number | null;
  charge: number | null;
  quest: number | null;
  study: number | null;
  lore: number | null;
  age: number | null;
  time: number | null;
  fade: number | null;
  level: number | null;
  storage: number | null;
  mining: number | null;
  brick: number | null;
  depletion: number | null;
  page: number | null;
  damage: number | null;
}

export const DEFAULT_DEV_CARD_OVERRIDES: DevCardOverrides = {
  forceTapped: false,
  forceSummoningSick: false,
  forceExerted: false,
  forceFaceDown: false,
  forceBestowed: false,
  forceTransformed: false,
  forcePlotted: false,
  forceMadnessExiled: false,
  forceWarpExiled: false,
  forceCopy: false,
  forceToken: false,
  forceFoil: false,
  forcePhasedOut: false,
  forceAttacking: false,
  forcePlayable: false,
  forceSelected: false,
  forceDoubleFaced: false,
  p1p1: null,
  m1m1: null,
  loyalty: null,
  charge: null,
  quest: null,
  study: null,
  lore: null,
  age: null,
  time: null,
  fade: null,
  level: null,
  storage: null,
  mining: null,
  brick: null,
  depletion: null,
  page: null,
  damage: null,
};

interface GameDevState {
  promptActionOverride: DevPromptActionOverride | null;
  devToolsEnabled: boolean;
  pixiPerfStats: PixiPerfStats | null;
  playerOverrides: DevPlayerOverrides;
  cardOverrides: DevCardOverrides;
  etbGlowVersion: number;
  debugArrowType: ArrowType | null;
  debugBattlefieldKeywords: string[];
  debugCardEnabled: boolean;
  debugCardName: string;
  showHoverAreas: boolean;
  setShowHoverAreas: (value: boolean) => void;
  setPromptActionOverride: (value: DevPromptActionOverride | null) => void;
  setDevToolsEnabled: (value: boolean) => void;
  clearPromptActionOverride: () => void;
  setPixiPerfStats: (stats: PixiPerfStats | null) => void;
  setPlayerOverride: <K extends keyof DevPlayerOverrides>(
    key: K,
    value: DevPlayerOverrides[K],
  ) => void;
  resetPlayerOverrides: () => void;
  setCardOverride: <K extends keyof DevCardOverrides>(key: K, value: DevCardOverrides[K]) => void;
  resetCardOverrides: () => void;
  triggerEtbGlow: () => void;
  setDebugArrowType: (type: ArrowType | null) => void;
  toggleDebugBattlefieldKeyword: (keyword: string) => void;
  clearDebugBattlefieldKeywords: () => void;
  setDebugCardEnabled: (value: boolean) => void;
  setDebugCardName: (name: string) => void;
  resetDevSettings: () => void;
}

export const useGameDevStore = create<GameDevState>()(
  devtools(
    (set) => ({
      promptActionOverride: null,
      devToolsEnabled: false,
      pixiPerfStats: null,
      playerOverrides: DEFAULT_DEV_PLAYER_OVERRIDES,
      cardOverrides: DEFAULT_DEV_CARD_OVERRIDES,
      etbGlowVersion: 0,
      debugArrowType: null,
      debugBattlefieldKeywords: [],
      debugCardEnabled: false,
      debugCardName: "Raging Goblin",
      showHoverAreas: false,
      setShowHoverAreas: (value) => set({ showHoverAreas: value }),
      setPromptActionOverride: (value) => set({ promptActionOverride: value }),
      setDevToolsEnabled: (value) => set({ devToolsEnabled: value }),
      clearPromptActionOverride: () => set({ promptActionOverride: null }),
      setPixiPerfStats: (stats) => set({ pixiPerfStats: stats }),
      setPlayerOverride: (key, value) =>
        set((state) => ({
          playerOverrides: { ...state.playerOverrides, [key]: value },
        })),
      resetPlayerOverrides: () => set({ playerOverrides: DEFAULT_DEV_PLAYER_OVERRIDES }),
      setCardOverride: (key, value) =>
        set((state) => ({
          cardOverrides: { ...state.cardOverrides, [key]: value },
        })),
      resetCardOverrides: () => set({ cardOverrides: DEFAULT_DEV_CARD_OVERRIDES }),
      triggerEtbGlow: () => set((s) => ({ etbGlowVersion: s.etbGlowVersion + 1 })),
      setDebugArrowType: (type) => set({ debugArrowType: type }),
      toggleDebugBattlefieldKeyword: (keyword) =>
        set((state) => {
          const has = state.debugBattlefieldKeywords.includes(keyword);
          return {
            debugBattlefieldKeywords: has
              ? state.debugBattlefieldKeywords.filter((k) => k !== keyword)
              : [...state.debugBattlefieldKeywords, keyword],
          };
        }),
      clearDebugBattlefieldKeywords: () => set({ debugBattlefieldKeywords: [] }),
      setDebugCardEnabled: (value) => set({ debugCardEnabled: value }),
      setDebugCardName: (name) => set({ debugCardName: name }),
      resetDevSettings: () =>
        set({
          promptActionOverride: null,
          devToolsEnabled: false,
          playerOverrides: DEFAULT_DEV_PLAYER_OVERRIDES,
          cardOverrides: DEFAULT_DEV_CARD_OVERRIDES,
          debugArrowType: null,
          debugBattlefieldKeywords: [],
          debugCardEnabled: false,
          debugCardName: "Raging Goblin",
          showHoverAreas: false,
        }),
    }),
    { name: "gameDev", enabled: import.meta.env.DEV },
  ),
);

export function hasActiveCardOverride(o: DevCardOverrides): boolean {
  return (
    o.forceTapped ||
    o.forceSummoningSick ||
    o.forceExerted ||
    o.forceFaceDown ||
    o.forceBestowed ||
    o.forceTransformed ||
    o.forcePlotted ||
    o.forceMadnessExiled ||
    o.forceWarpExiled ||
    o.forceCopy ||
    o.forceToken ||
    o.forceFoil ||
    o.forcePhasedOut ||
    o.forceAttacking ||
    o.forcePlayable ||
    o.forceSelected ||
    o.forceDoubleFaced ||
    o.p1p1 != null ||
    o.m1m1 != null ||
    o.loyalty != null ||
    o.charge != null ||
    o.quest != null ||
    o.study != null ||
    o.lore != null ||
    o.age != null ||
    o.time != null ||
    o.fade != null ||
    o.level != null ||
    o.storage != null ||
    o.mining != null ||
    o.brick != null ||
    o.depletion != null ||
    o.page != null ||
    o.damage != null
  );
}

import type { CardDto } from "@/protocol/game";

export function applyCardOverrides(card: CardDto, o: DevCardOverrides): CardDto {
  if (!hasActiveCardOverride(o)) return card;
  const counters = { ...(card.counters ?? {}) };
  if (o.p1p1 != null) counters.P1P1 = o.p1p1;
  if (o.m1m1 != null) counters.M1M1 = o.m1m1;
  if (o.loyalty != null) counters.Loyalty = o.loyalty;
  if (o.charge != null) counters.Charge = o.charge;
  if (o.quest != null) counters.Quest = o.quest;
  if (o.study != null) counters.Study = o.study;
  if (o.lore != null) counters.Lore = o.lore;
  if (o.age != null) counters.Age = o.age;
  if (o.time != null) counters.Time = o.time;
  if (o.fade != null) counters.Fade = o.fade;
  if (o.level != null) counters.Level = o.level;
  if (o.storage != null) counters.Storage = o.storage;
  if (o.mining != null) counters.Mining = o.mining;
  if (o.brick != null) counters.Brick = o.brick;
  if (o.depletion != null) counters.Depletion = o.depletion;
  if (o.page != null) counters.Page = o.page;
  return {
    ...card,
    tapped: o.forceTapped || card.tapped,
    summoningSick: o.forceSummoningSick || card.summoningSick,
    exerted: o.forceExerted || card.exerted,
    isFaceDown: o.forceFaceDown || card.isFaceDown,
    isBestowed: o.forceBestowed || card.isBestowed,
    isTransformed: o.forceTransformed || card.isTransformed,
    isPlotted: o.forcePlotted || card.isPlotted,
    isMadnessExiled: o.forceMadnessExiled || card.isMadnessExiled,
    isWarpExiled: o.forceWarpExiled || card.isWarpExiled,
    isCopy: o.forceCopy || card.isCopy,
    isToken: o.forceToken || card.isToken,
    foil: o.forceFoil || card.foil,
    phasedOut: o.forcePhasedOut || card.phasedOut,
    isAttacking: o.forceAttacking || card.isAttacking,
    isDoubleFaced: o.forceDoubleFaced || card.isDoubleFaced,
    damage: o.damage != null ? o.damage : card.damage,
    counters,
  };
}

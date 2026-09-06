import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { CardDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import type { ArrowType } from "@/pixi/types";

export const DEBUG_KEYWORD_CARD_ID = "dev-keyword-card";
export const DEFAULT_DEBUG_CARD_NAME = "Raging Goblin";

export const PROMPT_ACTION_VIEW_KEYS = [
  "chooseAction",
  "chooseAttackers",
  "chooseBlockers",
  "chooseDamageOrder",
  "chooseTargetSpell",
  "payManaCost",
  "promptRequired",
  "promptLabel",
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
  "mulligan",
  "mulliganPutBack",
  "noAction",
] as const;

export type DevPromptActionOverride = (typeof DEV_PROMPT_ACTION_OVERRIDES)[number];

export type DevCardRailMode = "page" | "saga" | "class";
export type DevViewportPreset = "native" | "phone" | "tablet" | "desktop" | "ultrawide";

const DEFAULT_DEV_CARD_RAIL_MODE: DevCardRailMode = "page";
const DEFAULT_DEV_CARD_RAIL_CURRENT = 1;
const DEFAULT_DEV_CARD_RAIL_FINAL = 3;

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
  forceEnduringStory: boolean;
  forceBot: boolean;
  forceNoAvatar: boolean;
  forceActiveTurn: boolean;
  forcePriority: boolean;
  forceTargetable: boolean;
  forceSelectedTarget: boolean;
  forceFlashing: boolean;
  forceEliminated: boolean;
  forceDisconnected: boolean;
  forceUnlimitedHand: boolean;
  forceUnlimitedLands: boolean;
  forceExtraTurn: boolean;
  forceControlledBy: boolean;
  forcePlayerKeyword: boolean;
  forceInCombat: boolean;
  forceCombatLethal: boolean;
  poison: number | null;
  energy: number | null;
  radiation: number | null;
  experience: number | null;
  ticket: number | null;
  ringLevel: number | null;
  speed: number | null;
  cmdDamage: number | null;
  incomingDamage: number | null;
  manaWhite: number | null;
  manaBlue: number | null;
  manaBlack: number | null;
  manaRed: number | null;
  manaGreen: number | null;
  manaColorless: number | null;
  maxHandSize: number | null;
  landsPlayed: number | null;
  maxLandPlays: number | null;
  cardsDrawn: number | null;
  damagePrevention: number | null;
  extraTurnCount: number | null;
  commanderCasts: number | null;
  graveyardCardTypes: number | null;
  life: number | null;
  handCount: number | null;
}

export interface DevGameStateOverrides {
  forceLogActivity: boolean;
  forceCombatSummary: boolean;
  dayNight: "none" | "day" | "night";
  forceDungeon: boolean;
  forcePlane: boolean;
  forceScheme: boolean;
  forceTeam: boolean;
}

export const DEFAULT_DEV_GAME_STATE_OVERRIDES: DevGameStateOverrides = {
  forceLogActivity: false,
  forceCombatSummary: false,
  dayNight: "none",
  forceDungeon: false,
  forcePlane: false,
  forceScheme: false,
  forceTeam: false,
};

export const DEFAULT_DEV_PLAYER_OVERRIDES: DevPlayerOverrides = {
  forceMonarch: false,
  forceInitiative: false,
  forceCityBlessing: false,
  forceEnduringStory: false,
  forceBot: false,
  forceNoAvatar: false,
  forceActiveTurn: false,
  forcePriority: false,
  forceTargetable: false,
  forceSelectedTarget: false,
  forceFlashing: false,
  forceEliminated: false,
  forceDisconnected: false,
  forceInCombat: false,
  forceCombatLethal: false,
  poison: null,
  energy: null,
  radiation: null,
  forceUnlimitedHand: false,
  forceUnlimitedLands: false,
  forceExtraTurn: false,
  forceControlledBy: false,
  forcePlayerKeyword: false,
  experience: null,
  ticket: null,
  ringLevel: null,
  speed: null,
  cmdDamage: null,
  incomingDamage: null,
  manaWhite: null,
  manaBlue: null,
  manaBlack: null,
  manaRed: null,
  manaGreen: null,
  manaColorless: null,
  maxHandSize: null,
  landsPlayed: null,
  maxLandPlays: null,
  cardsDrawn: null,
  damagePrevention: null,
  extraTurnCount: null,
  commanderCasts: null,
  graveyardCardTypes: null,
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
  allowIllegalDecks: boolean;
  setAllowIllegalDecks: (value: boolean) => void;
  promptActionOverride: DevPromptActionOverride | null;
  devToolsEnabled: boolean;
  pixiPerfStats: PixiPerfStats | null;
  playerOverrides: DevPlayerOverrides;
  cardOverrides: DevCardOverrides;
  gameStateOverrides: DevGameStateOverrides;
  etbGlowVersion: number;
  debugArrowType: ArrowType | null;
  debugBattlefieldKeywords: string[];
  debugCardEnabled: boolean;
  debugCardName: string;
  debugCardDefinition: DeckCard | null;
  debugCardRailEnabled: boolean;
  debugCardMode: DevCardRailMode;
  debugCardCurrent: number;
  debugCardFinal: number;
  debugViewportPreset: DevViewportPreset;
  showHoverAreas: boolean;
  setShowHoverAreas: (value: boolean) => void;
  showPlayerPanelBounds: boolean;
  setShowPlayerPanelBounds: (value: boolean) => void;
  showGridSkeleton: boolean;
  setShowGridSkeleton: (value: boolean) => void;
  showAttackRows: boolean;
  setShowAttackRows: (value: boolean) => void;
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
  setGameStateOverride: <K extends keyof DevGameStateOverrides>(
    key: K,
    value: DevGameStateOverrides[K],
  ) => void;
  resetGameStateOverrides: () => void;
  resetCardOverrides: () => void;
  triggerEtbGlow: () => void;
  setDebugArrowType: (type: ArrowType | null) => void;
  toggleDebugBattlefieldKeyword: (keyword: string) => void;
  clearDebugBattlefieldKeywords: () => void;
  setDebugCardEnabled: (value: boolean) => void;
  setDebugCard: (card: DeckCard) => void;
  setDebugCardRailEnabled: (value: boolean) => void;
  setDebugCardMode: (mode: DevCardRailMode) => void;
  setDebugCardRail: (current: number, final: number) => void;
  setDebugCardCurrent: (value: number) => void;
  setDebugCardFinal: (value: number) => void;
  resetDebugCardRail: () => void;
  setDebugViewportPreset: (preset: DevViewportPreset) => void;
  resetDevSettings: () => void;
}

export const useGameDevStore = create<GameDevState>()(
  devtools(
    (set) => ({
      allowIllegalDecks: false,
      setAllowIllegalDecks: (value) => set({ allowIllegalDecks: value }),
      promptActionOverride: null,
      devToolsEnabled: false,
      pixiPerfStats: null,
      playerOverrides: DEFAULT_DEV_PLAYER_OVERRIDES,
      cardOverrides: DEFAULT_DEV_CARD_OVERRIDES,
      gameStateOverrides: DEFAULT_DEV_GAME_STATE_OVERRIDES,
      etbGlowVersion: 0,
      debugArrowType: null,
      debugBattlefieldKeywords: [],
      debugCardEnabled: false,
      debugCardName: DEFAULT_DEBUG_CARD_NAME,
      debugCardDefinition: null,
      debugCardRailEnabled: false,
      debugCardMode: DEFAULT_DEV_CARD_RAIL_MODE,
      debugCardCurrent: DEFAULT_DEV_CARD_RAIL_CURRENT,
      debugCardFinal: DEFAULT_DEV_CARD_RAIL_FINAL,
      debugViewportPreset: "native",
      showHoverAreas: false,
      setShowHoverAreas: (value) => set({ showHoverAreas: value }),
      showPlayerPanelBounds: false,
      setShowPlayerPanelBounds: (value) => set({ showPlayerPanelBounds: value }),
      showGridSkeleton: false,
      setShowGridSkeleton: (value) => set({ showGridSkeleton: value }),
      showAttackRows: false,
      setShowAttackRows: (value) => set({ showAttackRows: value }),
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
      setGameStateOverride: (key, value) =>
        set((state) => ({
          gameStateOverrides: { ...state.gameStateOverrides, [key]: value },
        })),
      resetGameStateOverrides: () => set({ gameStateOverrides: DEFAULT_DEV_GAME_STATE_OVERRIDES }),
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
      setDebugCard: (card) => set({ debugCardName: card.identity.name, debugCardDefinition: card }),
      setDebugCardRailEnabled: (value) => set({ debugCardRailEnabled: value }),
      setDebugCardMode: (mode) => set({ debugCardMode: mode }),
      setDebugCardRail: (current, final) =>
        set(() => {
          const nextFinal = Math.max(1, Math.trunc(final));
          return {
            debugCardFinal: nextFinal,
            debugCardCurrent: Math.max(0, Math.min(nextFinal, Math.trunc(current))),
          };
        }),
      setDebugCardCurrent: (value) =>
        set((state) => ({
          debugCardCurrent: Math.max(0, Math.min(state.debugCardFinal, Math.trunc(value))),
        })),
      setDebugCardFinal: (value) =>
        set((state) => {
          const nextFinal = Math.max(1, Math.trunc(value));
          return {
            debugCardFinal: nextFinal,
            debugCardCurrent: Math.min(state.debugCardCurrent, nextFinal),
          };
        }),
      resetDebugCardRail: () =>
        set({
          debugCardRailEnabled: false,
          debugCardMode: DEFAULT_DEV_CARD_RAIL_MODE,
          debugCardCurrent: DEFAULT_DEV_CARD_RAIL_CURRENT,
          debugCardFinal: DEFAULT_DEV_CARD_RAIL_FINAL,
        }),
      setDebugViewportPreset: (debugViewportPreset) => set({ debugViewportPreset }),
      resetDevSettings: () =>
        set({
          promptActionOverride: null,
          devToolsEnabled: false,
          playerOverrides: DEFAULT_DEV_PLAYER_OVERRIDES,
          cardOverrides: DEFAULT_DEV_CARD_OVERRIDES,
          gameStateOverrides: DEFAULT_DEV_GAME_STATE_OVERRIDES,
          debugArrowType: null,
          debugBattlefieldKeywords: [],
          debugCardEnabled: false,
          debugCardName: DEFAULT_DEBUG_CARD_NAME,
          debugCardDefinition: null,
          debugCardRailEnabled: false,
          debugCardMode: DEFAULT_DEV_CARD_RAIL_MODE,
          debugCardCurrent: DEFAULT_DEV_CARD_RAIL_CURRENT,
          debugCardFinal: DEFAULT_DEV_CARD_RAIL_FINAL,
          debugViewportPreset: "native",
          showHoverAreas: false,
          showPlayerPanelBounds: false,
          showGridSkeleton: false,
          showAttackRows: false,
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
function applyCounterDeltaToStat(stat: string | null, counterDelta: number): string | null {
  if (stat == null || counterDelta === 0) return stat;
  const numericStat = Number(stat);
  return Number.isFinite(numericStat) ? String(numericStat + counterDelta) : stat;
}

export function applyCardOverrides(card: CardDto, o: DevCardOverrides): CardDto {
  if (!hasActiveCardOverride(o)) return card;
  const counters = { ...(card.counters ?? {}) };
  if (o.p1p1 != null) counters.P1P1 = o.p1p1;
  if (o.m1m1 != null) counters.M1M1 = o.m1m1;
  const previousP1P1 = card.counters?.P1P1 ?? 0;
  const previousM1M1 = card.counters?.M1M1 ?? 0;
  const nextP1P1 = o.p1p1 ?? previousP1P1;
  const nextM1M1 = o.m1m1 ?? previousM1M1;
  const counterDelta = nextP1P1 - nextM1M1 - (previousP1P1 - previousM1M1);
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
    power: applyCounterDeltaToStat(card.power, counterDelta),
    toughness: applyCounterDeltaToStat(card.toughness, counterDelta),
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
    identity: { ...card.identity, isToken: o.forceToken || card.identity.isToken },
    foil: o.forceFoil || card.foil,
    phasedOut: o.forcePhasedOut || card.phasedOut,
    isAttacking: o.forceAttacking || card.isAttacking,
    isDoubleFaced: o.forceDoubleFaced || card.isDoubleFaced,
    damage: o.damage != null ? o.damage : card.damage,
    counters,
  };
}

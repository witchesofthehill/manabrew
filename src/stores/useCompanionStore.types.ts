export type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
export const MANA_COLORS: readonly ManaColor[] = ["W", "U", "B", "R", "G", "C"];

export type CompanionCounterKind =
  | "poison"
  | "energy"
  | "experience"
  | "rad"
  | "tickets"
  | "storm"
  | "custom";

export interface CompanionCounter {
  id: string;
  kind: CompanionCounterKind;
  label: string;
  value: number;
  iconKey?: string;
}

export interface CompanionCommanderRef {
  scryfallId?: string;
  name: string;
  imageUrl?: string;
}

export type CompanionCommanderSlot = 0 | 1;

export interface CompanionPlayer {
  id: string;
  name: string;
  accentKey: CompanionAccentKey;
  life: number;
  counters: CompanionCounter[];
  commanders: [CompanionCommanderRef | null, CompanionCommanderRef | null];
  /** Damage received per source player, per commander slot of the target. */
  commanderDamage: Record<string, [number, number]>;
  isDead: boolean;
  isMonarch?: boolean;
  hasInitiative?: boolean;
  hasCityBlessing?: boolean;
  ringLevel?: number;
  speed?: number;
  manaPool?: Partial<Record<ManaColor, number>>;
  /** Total chess-clock time accumulated while this player was active. */
  timeMs?: number;
  /** Free-form note shown in the player menu. */
  notes?: string;
  /** Free-layout position, rotation and scale (only consulted when layout === "free"). */
  freeLayout?: { x: number; y: number; rotation: number; scale?: number };
}

export type CompanionAccentKey =
  | "crimson"
  | "azure"
  | "emerald"
  | "amber"
  | "violet"
  | "rose"
  | "teal"
  | "slate";

export type CompanionPhase = "untap" | "upkeep" | "draw" | "main1" | "combat" | "main2" | "end";

export type CompanionLayout =
  | "1v1"
  | "two-side"
  | "three-wedge"
  | "pinwheel-3"
  | "quad"
  | "four-sides"
  | "five-radial"
  | "six-grid"
  | "pinwheel-6"
  | "landscape-row"
  | "vertical-stack"
  | "free";

export type CompanionEvent =
  | { type: "life"; playerId: string; prev: number; next: number; at: number }
  | {
      type: "counter";
      playerId: string;
      counterId: string;
      prev: number;
      next: number;
      at: number;
    }
  | {
      type: "cmdDmg";
      targetId: string;
      sourceId: string;
      slot: CompanionCommanderSlot;
      prev: number;
      next: number;
      prevLife: number;
      nextLife: number;
      prevDead: boolean;
      nextDead: boolean;
      at: number;
    }
  | { type: "counterAdd"; playerId: string; counter: CompanionCounter; at: number }
  | {
      type: "counterRemove";
      playerId: string;
      counter: CompanionCounter;
      index: number;
      at: number;
    }
  | {
      type: "commander";
      playerId: string;
      slot: CompanionCommanderSlot;
      prev: CompanionCommanderRef | null;
      next: CompanionCommanderRef | null;
      at: number;
    }
  | { type: "dead"; playerId: string; prev: boolean; next: boolean; at: number };

export interface CompanionSession {
  id: string;
  createdAt: number;
  startingLife: number;
  commanderRules: boolean;
  layout: CompanionLayout;
  players: CompanionPlayer[];
  history: CompanionEvent[];
  redoStack: CompanionEvent[];
  dayNight: "day" | "night" | null;
  timer: { startedAt: number | null; pausedAt: number | null; accumulatedMs: number };
  timerMode: "shared" | "chess";
  chessClockStartedAt: number | null;
  phase: CompanionPhase;
  /** When true, the partner commander slot represents an Oathbreaker
   *  "signature spell" rather than a second commander. UI-only flag. */
  oathbreaker?: boolean;
  /** Optional user-supplied label for the game (e.g. "Friday EDH at Marco's"). */
  tag?: string;
  activePlayerId: string | null;
  turn: number;
  lastFirstPlayerId: string | null;
}

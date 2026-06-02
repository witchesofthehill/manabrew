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
  timer: { startedAt: number | null; pausedAt: number | null; accumulatedMs: number };
  activePlayerId: string | null;
  turn: number;
  lastFirstPlayerId: string | null;
}

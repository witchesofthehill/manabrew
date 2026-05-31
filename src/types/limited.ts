import type { CardIdentity } from "@/types/manabrew";

export type LimitedPoolType =
  | "Full"
  | "Block"
  | "Prerelease"
  | "FantasyBlock"
  | "Custom"
  | "Chaos"
  | "Import";

export interface GauntletMatchDecks {
  humanDeckName: string;
  humanMain: DraftCard[];
  humanSideboard: DraftCard[];
  opponentName: string;
  opponentMain: DraftCard[];
  opponentSideboard: DraftCard[];
}

export type DraftCard = CardIdentity;

export interface LimitedDeck {
  name: string;
  main: DraftCard[];
  sideboard: DraftCard[];
}

export interface SealedPool {
  sessionId: string;
  deckName: string;
  landSetCode: string | null;
  cards: DraftCard[];
  suggestedDeck: LimitedDeck | null;
  aiDecks: LimitedDeck[];
}

export interface SealedSetup {
  poolType: LimitedPoolType;
  numBoosters: number;
  pool: DraftCard[];
  variant?: string;
  seed?: number;
}

export interface SealedTemplateMetadata {
  id: string;
  label: string;
  description: string;
  numPacks: number;
}

export interface DraftSeat {
  seat: number;
  name: string;
  isHuman: boolean;
  picksMade: number;
  lastPickName: string | null;
}

export interface DraftState {
  sessionId: string;
  round: number;
  totalRounds: number;
  pickNumber: number;
  packSize: number;
  currentPack: DraftCard[];
  pickedPile: DraftCard[];
  seatSummaries: DraftSeat[];
  isRoundOver: boolean;
  isComplete: boolean;
  awaitingHuman: boolean;
  humanConspiracies?: string[];
  picksPerPass: number;
  picksRemainingInPack: number;
}

export interface BoosterDraftSetup {
  podSize: number;
  rounds: number;
  pool: DraftCard[];
  variant?: string;
  seed?: number;
  picksPerPass?: number;
}

export interface WinstonSetup {
  poolPacks: number;
  pool: DraftCard[];
  variant?: string;
  seed?: number;
}

export interface WinstonState {
  sessionId: string;
  activeSeat: number;
  currentPile: number;
  piles: DraftCard[][];
  deckSize: number;
  pickedPile: DraftCard[];
  aiPickCount: number;
  awaitingHuman: boolean;
  isComplete: boolean;
}

export interface CubeImportRequest {
  cubeIdOrUrl: string;
}

export interface CubeImportResult {
  cubeId: string;
  name: string;
  cardCount: number;
  numPacks: number;
  singleton: boolean;
  pool?: DraftCard[];
}

export interface ChaosTheme {
  tag: string;
  label: string;
  orderNumber: number;
}

export interface GauntletOpponent {
  round: number;
  deckName: string;
  mainCount: number;
  sideboardCount: number;
}

export interface GauntletState {
  gauntletId: string;
  kind: "sealed" | "draft";
  rounds: number;
  currentRound: number;
  wins: number;
  losses: number;
  completed: boolean;
  humanDeckName: string;
  opponents: GauntletOpponent[];
  currentOpponent: GauntletOpponent | null;
}

export type GauntletOutcomeKind =
  | "matchInProgress"
  | "advanceNextRound"
  | "wonTournament"
  | "lostRound";

export interface GauntletOutcome {
  state: GauntletState;
  outcome: GauntletOutcomeKind;
  nextRoundIndex: number | null;
}

export interface ConspiracyHook {
  cardName: string;
  flagName: string;
  description: string;
}

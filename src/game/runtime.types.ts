import type { IGameApi } from "@/platform";
import type { CardDto, GameViewDto } from "@/protocol/game";

export type GameRuntimeKind = "manabrew" | "forge" | "manual-tabletop";

export type SeatControllerKind =
  | "local-human"
  | "remote-human"
  | "built-in-bot"
  | "llm-bot"
  | "manual-operator";

export type ConcedeBehavior = "send-action" | "end-session";

export interface GameRuntimeCapabilities {
  multiplayer: boolean;
  snapshots: boolean;
  deckAvailabilityCheck: boolean;
  manualTabletop: boolean;
  concedeBehavior: ConcedeBehavior;
}

export interface GameRuntime {
  readonly kind: GameRuntimeKind;
  readonly label: string;
  readonly capabilities: GameRuntimeCapabilities;
  readonly api: IGameApi;
}

export interface ManualTabletopApi extends IGameApi {
  applyManualAction(action: ManualTabletopAction): Promise<GameViewDto>;
  getGameView(): GameViewDto | null;
}

export interface BaseSeatController {
  kind: SeatControllerKind;
  playerSlot: string;
  displayName: string;
}

export interface LocalHumanSeatController extends BaseSeatController {
  kind: "local-human";
}

export interface RemoteHumanSeatController extends BaseSeatController {
  kind: "remote-human";
  peerId: string;
}

export interface BuiltInBotSeatController extends BaseSeatController {
  kind: "built-in-bot";
  policy: "deterministic" | "random" | "heuristic";
}

export interface LlmBotSeatController extends BaseSeatController {
  kind: "llm-bot";
  model: string;
  strategyPrompt?: string;
}

export interface ManualOperatorSeatController extends BaseSeatController {
  kind: "manual-operator";
}

export type SeatController =
  | LocalHumanSeatController
  | RemoteHumanSeatController
  | BuiltInBotSeatController
  | LlmBotSeatController
  | ManualOperatorSeatController;

export interface GameSessionDescriptor {
  id: string;
  runtimeKind: GameRuntimeKind;
  seats: SeatController[];
  hostPlayerSlot: string | null;
}

export type ManualTabletopAction =
  | {
      type: "moveCard";
      cardId: string;
      fromZoneId: string;
      toZoneId: string;
      position?: number;
    }
  | { type: "tapCard"; cardId: string; tapped: boolean }
  | { type: "setCounter"; cardId: string; counterType: string; count: number }
  | { type: "adjustLife"; playerId: string; delta: number }
  | { type: "setLife"; playerId: string; life: number }
  | { type: "setPoison"; playerId: string; poison: number }
  | { type: "createCard"; controllerId: string; card: CardDto; zoneId?: string }
  | { type: "createToken"; controllerId: string; card: CardDto }
  | { type: "removeToken"; cardId: string }
  | { type: "drawLibraryCard"; playerId: string; count?: number }
  | { type: "putLibraryCardOntoBattlefield"; playerId: string }
  | { type: "shuffleLibrary"; playerId: string }
  | { type: "revealCards"; playerId: string; cardIds: string[] }
  | { type: "hideCards"; playerId: string; cardIds: string[] }
  | { type: "replaceState"; gameView: GameViewDto; libraries?: Record<string, CardDto[]> };

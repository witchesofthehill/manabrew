import { getPlatform } from "@/platform";
import type {
  RespondParams,
  RestoreSnapshotParams,
  SendDirectiveParams,
  StartGameParams,
  StartMultiplayerGameParams,
} from "@/platform";
import type { CardDto } from "@/protocol/game";
import type { Prompt } from "@/protocol";
import type { ClientCardDto, ClientGameView, ClientPlayerDto } from "@/stores/gameStore.types";
import type { ManualTabletopApi, ManualTabletopAction } from "./runtime.types";

const MANUAL_GAME_ID = "manual-tabletop";

function createPlayer(
  id: string,
  name: string,
  isHuman: boolean,
  life: number,
  libraryCount: number,
): ClientPlayerDto {
  return {
    id,
    name,
    status: "playing",
    isHuman,
    life,
    poison: 0,
    hand: [],
    graveyard: [],
    library: [],
    exile: [],
    commandZone: [],
    libraryCount,
    handCount: 0,
    manaPool: {},
    counters: {},
    commanderDamage: {},
    energyCounters: 0,
    radiationCounters: 0,
    hasCityBlessing: false,
    ringLevel: 0,
    speed: 0,
    experienceCounters: 0,
    ticketCounters: 0,
  };
}

type PlayerZoneKey = "hand" | "graveyard" | "exile" | "commandZone";

// Manual sandbox is 1v1: zone ids map to (seat index, per-player zone) or the
// shared battlefield.
function resolveManualZone(
  zoneId: string,
): { seat: number; key: PlayerZoneKey } | "battlefield" | null {
  switch (zoneId) {
    case "hand":
      return { seat: 0, key: "hand" };
    case "graveyard":
      return { seat: 0, key: "graveyard" };
    case "exile":
      return { seat: 0, key: "exile" };
    case "command":
      return { seat: 0, key: "commandZone" };
    case "opponentGraveyard":
      return { seat: 1, key: "graveyard" };
    case "opponentExile":
      return { seat: 1, key: "exile" };
    case "opponentCommand":
      return { seat: 1, key: "commandZone" };
    case "battlefield":
      return "battlefield";
    default:
      return null;
  }
}

// Apply `fn` to the battlefield and every player's hand/graveyard/exile/command.
function mapAllZones(
  gameView: ClientGameView,
  fn: (cards: ClientCardDto[]) => ClientCardDto[],
): ClientGameView {
  return {
    ...gameView,
    battlefield: fn(gameView.battlefield),
    players: gameView.players.map((p) => ({
      ...p,
      hand: fn(p.hand),
      graveyard: fn(p.graveyard),
      exile: fn(p.exile),
      commandZone: fn(p.commandZone),
    })),
  };
}

function createInitialGameView(params: StartGameParams): ClientGameView {
  const human = createPlayer(
    "player-0",
    "PlayerDto 1",
    true,
    params.startingLife,
    params.deck.cards.length,
  );
  const opponent = createPlayer(
    "player-1",
    "PlayerDto 2",
    false,
    params.startingLife,
    params.opponentDecks?.[0]?.cards.length ?? params.deck.cards.length,
  );

  return {
    gameId: MANUAL_GAME_ID,
    turn: 1,
    step: "main1",
    activePlayerId: human.id,
    priorityPlayerId: human.id,
    players: [human, opponent],
    zones: [],
    battlefield: [],
    stack: [],
    combatAssignments: [],
    gameOver: false,
    winnerId: null,
    monarchId: null,
    initiativeHolderId: null,
    dayTime: "neither",
  };
}

function updateVisibleCard(
  gameView: ClientGameView,
  cardId: string,
  update: (card: ClientCardDto) => ClientCardDto,
): ClientGameView {
  return mapAllZones(gameView, (cards) =>
    cards.map((card) => (card.id === cardId ? update(card) : card)),
  );
}

function removeVisibleCard(
  gameView: ClientGameView,
  cardId: string,
): { gameView: ClientGameView; card: ClientCardDto | null } {
  let removed: ClientCardDto | null = null;
  const removeFrom = (cards: ClientCardDto[]): ClientCardDto[] =>
    cards.filter((card) => {
      if (card.id !== cardId) return true;
      removed = card;
      return false;
    });

  return {
    gameView: mapAllZones(gameView, removeFrom),
    card: removed,
  };
}

function addCardToZone(
  gameView: ClientGameView,
  zoneId: string,
  card: CardDto,
  position?: number,
): ClientGameView {
  const withInsertedCard = (cards: ClientCardDto[]): ClientCardDto[] => {
    const nextCard: ClientCardDto = { ...card, zoneId };
    if (position == null || position < 0 || position >= cards.length) {
      return [...cards, nextCard];
    }
    return [...cards.slice(0, position), nextCard, ...cards.slice(position)];
  };

  const target = resolveManualZone(zoneId);
  if (target === null) return gameView;
  if (target === "battlefield") {
    return { ...gameView, battlefield: withInsertedCard(gameView.battlefield) };
  }
  return {
    ...gameView,
    players: gameView.players.map((player, seat) =>
      seat === target.seat
        ? { ...player, [target.key]: withInsertedCard(player[target.key]) }
        : player,
    ),
  };
}

function updatePlayer(
  gameView: ClientGameView,
  playerId: string,
  update: (player: ClientPlayerDto) => ClientPlayerDto,
): ClientGameView {
  return {
    ...gameView,
    players: gameView.players.map((player) => (player.id === playerId ? update(player) : player)),
  };
}

function syncVisibleZoneCountsWithLibraries(
  gameView: ClientGameView,
  libraries: Record<string, ClientCardDto[]>,
): ClientGameView {
  return {
    ...gameView,
    players: gameView.players.map((player) => ({
      ...player,
      libraryCount: libraries[player.id]?.length ?? player.libraryCount,
    })),
  };
}

export class ManualTabletopGameApi implements ManualTabletopApi {
  private gameView: ClientGameView | null = null;
  private latestPrompt: Prompt | null = null;
  private libraries: Record<string, ClientCardDto[]> = {};

  async startGame(params: StartGameParams): Promise<string> {
    this.gameView = createInitialGameView(params);
    this.libraries = {};
    this.emitStateUpdate();
    return MANUAL_GAME_ID;
  }

  async startMultiplayerGame(_params: StartMultiplayerGameParams): Promise<void> {
    throw new Error("Manual tabletop multiplayer is not implemented yet.");
  }

  async respond(_params: RespondParams): Promise<void> {
    throw new Error("Manual tabletop API expects manual table actions.");
  }

  async sendDirective(_params: SendDirectiveParams): Promise<void> {
    throw new Error("Manual tabletop has no engine to direct.");
  }

  async endGame(): Promise<void> {
    this.gameView = null;
    this.latestPrompt = null;
    this.libraries = {};
  }

  async restoreSnapshot(_params: RestoreSnapshotParams): Promise<void> {
    throw new Error("Manual tabletop snapshots are not implemented yet.");
  }

  async getPrompt(): Promise<Prompt | null> {
    return this.latestPrompt;
  }

  getGameView(): ClientGameView | null {
    return this.gameView;
  }

  async applyManualAction(action: ManualTabletopAction): Promise<ClientGameView> {
    if (!this.gameView && action.type !== "replaceState") {
      throw new Error("No active manual tabletop game.");
    }

    this.gameView = syncVisibleZoneCountsWithLibraries(
      this.applyAction(this.gameView, action),
      this.libraries,
    );
    this.emitStateUpdate();
    return this.gameView;
  }

  private applyAction(
    gameView: ClientGameView | null,
    action: ManualTabletopAction,
  ): ClientGameView {
    if (action.type === "replaceState") {
      this.libraries = action.libraries ?? {};
      return action.gameView;
    }
    if (!gameView) throw new Error("No active manual tabletop game.");

    switch (action.type) {
      case "moveCard": {
        const removed = removeVisibleCard(gameView, action.cardId);
        if (!removed.card) return gameView;
        return addCardToZone(removed.gameView, action.toZoneId, removed.card, action.position);
      }
      case "tapCard":
        return updateVisibleCard(gameView, action.cardId, (card) => ({
          ...card,
          tapped: action.tapped,
        }));
      case "setCounter":
        return updateVisibleCard(gameView, action.cardId, (card) => ({
          ...card,
          counters: {
            ...(card.counters ?? {}),
            [action.counterType]: action.count,
          },
        }));
      case "adjustLife":
        return updatePlayer(gameView, action.playerId, (player) => ({
          ...player,
          life: player.life + action.delta,
        }));
      case "setLife":
        return updatePlayer(gameView, action.playerId, (player) => ({
          ...player,
          life: action.life,
        }));
      case "setPoison":
        return updatePlayer(gameView, action.playerId, (player) => ({
          ...player,
          poison: action.poison,
        }));
      case "createCard":
        return addCardToZone(gameView, action.zoneId ?? "battlefield", {
          ...action.card,
          controllerId: action.controllerId,
          ownerId: action.controllerId,
          identity: { ...action.card.identity, isToken: action.card.identity.isToken ?? false },
        });
      case "createToken":
        return {
          ...gameView,
          battlefield: [
            ...gameView.battlefield,
            {
              ...action.card,
              controllerId: action.controllerId,
              ownerId: action.controllerId,
              zoneId: "battlefield",
              identity: { ...action.card.identity, isToken: true },
            },
          ],
        };
      case "removeToken":
        return removeVisibleCard(gameView, action.cardId).gameView;
      case "drawLibraryCard": {
        const library = this.libraries[action.playerId] ?? [];
        const count = Math.max(1, action.count ?? 1);
        const drawn = library.slice(0, count);
        this.libraries[action.playerId] = library.slice(drawn.length);
        if (drawn.length === 0 || action.playerId !== gameView.players[0]?.id) {
          return gameView;
        }
        return drawn.reduce((nextView, card) => addCardToZone(nextView, "hand", card), gameView);
      }
      case "putLibraryCardOntoBattlefield": {
        const library = this.libraries[action.playerId] ?? [];
        const [card, ...rest] = library;
        if (!card) return gameView;
        this.libraries[action.playerId] = rest;
        return addCardToZone(gameView, "battlefield", {
          ...card,
          controllerId: action.playerId,
          ownerId: action.playerId,
          tapped: false,
        });
      }
      case "shuffleLibrary": {
        const library = [...(this.libraries[action.playerId] ?? [])];
        for (let i = library.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [library[i], library[j]] = [library[j], library[i]];
        }
        this.libraries[action.playerId] = library;
        return gameView;
      }
      case "revealCards":
      case "hideCards":
        return gameView;
    }
  }

  private emitStateUpdate(): void {
    if (!this.gameView) return;
    getPlatform().events.emit("game:state", { gameView: this.gameView });
  }
}

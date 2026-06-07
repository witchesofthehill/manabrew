import { getPlatform } from "@/platform";
import type {
  RespondParams,
  RestoreSnapshotParams,
  StartGameParams,
  StartMultiplayerGameParams,
} from "@/platform";
import type { GameCard, Deck, GameView, Player } from "@/types/manabrew";
import type { Prompt } from "@/protocol";
import type { ManualTabletopApi, ManualTabletopAction } from "./runtime.types";

const MANUAL_GAME_ID = "manual-tabletop";

function createPlayer(
  id: string,
  name: string,
  isHuman: boolean,
  life: number,
  libraryCount: number,
): Player {
  return {
    id,
    name,
    isHuman,
    life,
    poison: 0,
    handCount: 0,
    libraryCount,
    graveyardCount: 0,
    exileCount: 0,
    manaPool: {},
  };
}

function createInitialGameView(params: StartGameParams): GameView {
  const human = createPlayer(
    "player-0",
    "Player 1",
    true,
    params.startingLife,
    params.deck.cards.length,
  );
  const opponent = createPlayer(
    "player-1",
    "Player 2",
    false,
    params.startingLife,
    params.opponentDeck?.cards.length ?? params.deck.cards.length,
  );

  return {
    gameId: MANUAL_GAME_ID,
    turn: 1,
    step: "Manual",
    activePlayerId: human.id,
    priorityPlayerId: human.id,
    players: [human, opponent],
    myHand: [],
    battlefield: [],
    stack: [],
    exile: [],
    graveyard: [],
    myCommandZone: [],
    opponentZones: {
      [opponent.id]: { graveyard: [], exile: [], commandZone: [] },
    },
    gameOver: false,
    winnerId: null,
  };
}

/** Manual tabletop is 1v1, so there's exactly one opponent slot to look up. */
function singleOpponentId(gameView: GameView): string | undefined {
  return Object.keys(gameView.opponentZones)[0];
}

function updateVisibleCard(
  gameView: GameView,
  cardId: string,
  update: (card: GameCard) => GameCard,
): GameView {
  const updateCards = (cards: GameCard[]): GameCard[] =>
    cards.map((card) => (card.id === cardId ? update(card) : card));

  const opponentZones = Object.fromEntries(
    Object.entries(gameView.opponentZones).map(([pid, z]) => [
      pid,
      {
        graveyard: updateCards(z.graveyard),
        exile: updateCards(z.exile),
        commandZone: updateCards(z.commandZone),
      },
    ]),
  );

  return {
    ...gameView,
    myHand: updateCards(gameView.myHand),
    battlefield: updateCards(gameView.battlefield),
    exile: updateCards(gameView.exile),
    graveyard: updateCards(gameView.graveyard),
    myCommandZone: updateCards(gameView.myCommandZone ?? []),
    opponentZones,
  };
}

function removeVisibleCard(
  gameView: GameView,
  cardId: string,
): { gameView: GameView; card: GameCard | null } {
  let removed: GameCard | null = null;
  const removeFrom = (cards: GameCard[]): GameCard[] =>
    cards.filter((card) => {
      if (card.id !== cardId) return true;
      removed = card;
      return false;
    });

  const opponentZones = Object.fromEntries(
    Object.entries(gameView.opponentZones).map(([pid, z]) => [
      pid,
      {
        graveyard: removeFrom(z.graveyard),
        exile: removeFrom(z.exile),
        commandZone: removeFrom(z.commandZone),
      },
    ]),
  );

  return {
    gameView: {
      ...gameView,
      myHand: removeFrom(gameView.myHand),
      battlefield: removeFrom(gameView.battlefield),
      exile: removeFrom(gameView.exile),
      graveyard: removeFrom(gameView.graveyard),
      myCommandZone: removeFrom(gameView.myCommandZone ?? []),
      opponentZones,
    },
    card: removed,
  };
}

function addCardToZone(
  gameView: GameView,
  zoneId: string,
  card: GameCard,
  position?: number,
): GameView {
  const withInsertedCard = (cards: GameCard[]): GameCard[] => {
    const nextCard = { ...card, zoneId };
    if (position == null || position < 0 || position >= cards.length) {
      return [...cards, nextCard];
    }
    return [...cards.slice(0, position), nextCard, ...cards.slice(position)];
  };

  switch (zoneId) {
    case "hand":
      return { ...gameView, myHand: withInsertedCard(gameView.myHand) };
    case "battlefield":
      return { ...gameView, battlefield: withInsertedCard(gameView.battlefield) };
    case "graveyard":
      return { ...gameView, graveyard: withInsertedCard(gameView.graveyard) };
    case "exile":
      return { ...gameView, exile: withInsertedCard(gameView.exile) };
    case "command":
      return {
        ...gameView,
        myCommandZone: withInsertedCard(gameView.myCommandZone ?? []),
      };
    case "opponentGraveyard":
    case "opponentExile":
    case "opponentCommand": {
      const oppId = singleOpponentId(gameView);
      if (!oppId) return gameView;
      const current = gameView.opponentZones[oppId] ?? {
        graveyard: [],
        exile: [],
        commandZone: [],
      };
      const next =
        zoneId === "opponentGraveyard"
          ? { ...current, graveyard: withInsertedCard(current.graveyard) }
          : zoneId === "opponentExile"
            ? { ...current, exile: withInsertedCard(current.exile) }
            : { ...current, commandZone: withInsertedCard(current.commandZone) };
      return {
        ...gameView,
        opponentZones: { ...gameView.opponentZones, [oppId]: next },
      };
    }
    default:
      return gameView;
  }
}

function updatePlayer(
  gameView: GameView,
  playerId: string,
  update: (player: Player) => Player,
): GameView {
  return {
    ...gameView,
    players: gameView.players.map((player) => (player.id === playerId ? update(player) : player)),
  };
}

function syncVisibleZoneCountsWithLibraries(
  gameView: GameView,
  libraries: Record<string, GameCard[]>,
): GameView {
  const humanId = gameView.players[0]?.id;
  const opponentId = gameView.players[1]?.id;
  return {
    ...gameView,
    players: gameView.players.map((player) => {
      if (player.id === humanId) {
        return {
          ...player,
          handCount: gameView.myHand.length,
          libraryCount: libraries[player.id]?.length ?? player.libraryCount,
          graveyardCount: gameView.graveyard.length,
          exileCount: gameView.exile.length,
        };
      }
      if (player.id === opponentId) {
        const oppZones = gameView.opponentZones[player.id];
        return {
          ...player,
          libraryCount: libraries[player.id]?.length ?? player.libraryCount,
          graveyardCount: oppZones?.graveyard.length ?? 0,
          exileCount: oppZones?.exile.length ?? 0,
        };
      }
      return player;
    }),
  };
}

export class ManualTabletopGameApi implements ManualTabletopApi {
  private gameView: GameView | null = null;
  private latestPrompt: Prompt | null = null;
  private libraries: Record<string, GameCard[]> = {};

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

  async endGame(): Promise<void> {
    this.gameView = null;
    this.latestPrompt = null;
    this.libraries = {};
  }

  async restoreSnapshot(_params: RestoreSnapshotParams): Promise<void> {
    throw new Error("Manual tabletop snapshots are not implemented yet.");
  }

  async getPresetDecks(): Promise<Deck[]> {
    return [];
  }

  async getPrompt(): Promise<Prompt | null> {
    return this.latestPrompt;
  }

  getGameView(): GameView | null {
    return this.gameView;
  }

  async applyManualAction(action: ManualTabletopAction): Promise<GameView> {
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

  private applyAction(gameView: GameView | null, action: ManualTabletopAction): GameView {
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
          zoneId: action.zoneId ?? "battlefield",
          isToken: action.card.isToken ?? false,
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
              isToken: true,
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
    const prompt: Prompt = {
      displayEvents: [],
      input: {
        type: "stateUpdate",
        gameView: this.gameView,
      },
    };
    this.latestPrompt = prompt;
    getPlatform().events.emit("game:prompt", prompt);
  }
}

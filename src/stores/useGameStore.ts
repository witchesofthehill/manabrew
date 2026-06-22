import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { toast } from "sonner";
import {
  BroadcastRoomHost,
  getSelectedGameRuntime,
  resetSelectedGameRuntime,
  selectGameRuntime,
  startManualRoomSync,
  stopManualRoomSync as stopActiveManualRoomSync,
} from "@/game";
import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
import { getFormat } from "@/lib/formats";
import { armActiveGameSession, clearActiveGameSession } from "@/lib/activeGameSession";
import { startHostedAiGame } from "@/game/hostedAiPlay";
import { getPlatform } from "@/platform";
import { applyPrompt } from "./gameStore.constants";
import { DEFAULT_STARTING_LIFE, useServerStore } from "./useServerStore";
import type { GameState } from "./gameStore.types";
import type { Prompt, PromptOutput } from "@/protocol";
import type { CardDto, GameViewDto } from "@/protocol/game";
import type { Deck, DeckCard } from "@/protocol/deck";
import type { EngineKind } from "@/types/server";
import { usePhaseStopStore } from "@/stores/usePhaseStopStore";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import type { GameRuntime, ManualTabletopApi } from "@/game";

export type { GameConfig, GameState, DisplayEvent, DeferredSnapshot } from "./gameStore.types";

function isManualTabletopApi(
  runtime: GameRuntime,
): runtime is GameRuntime & { api: ManualTabletopApi } {
  return runtime.capabilities.manualTabletop && "applyManualAction" in runtime.api;
}

function manualZoneCard(card: DeckCard, playerId: string, zoneId: string): CardDto {
  return {
    ...GAME_CARD_DEFAULTS,
    ...card,
    id: `manual-card-${crypto.randomUUID()}`,
    controllerId: playerId,
    ownerId: playerId,
    zoneId,
    tapped: false,
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    keywords: card.keywords ?? [],
    isDoubleFaced: card.isDoubleFaced ?? false,
  };
}

function seedManualDeck(
  gameView: GameViewDto,
  deck: Deck,
): { gameView: GameViewDto; libraries: Record<string, CardDto[]> } {
  const playerId = gameView.players[0]?.id ?? "player-0";
  const openingHandSize = Math.min(7, deck.cards.length);
  const hand = deck.cards
    .slice(0, openingHandSize)
    .map((card) => manualZoneCard(card, playerId, "hand"));
  const library = deck.cards
    .slice(openingHandSize)
    .map((card) => manualZoneCard(card, playerId, "library"));
  const commandZone = (deck.commanders ?? []).map((card) =>
    manualZoneCard(card, playerId, "command"),
  );

  return {
    gameView: {
      ...gameView,
      players: gameView.players.map((player) =>
        player.id === playerId
          ? {
              ...player,
              hand,
              commandZone,
              libraryCount: library.length,
            }
          : player,
      ),
    },
    libraries: {
      [playerId]: library,
    },
  };
}

async function initializeGame({
  deck,
  opponentDeck,
  formatId,
  set,
  commanderName,
  engine,
}: {
  deck: Deck;
  opponentDeck?: Deck;
  formatId?: string;
  commanderName?: string;
  engine?: EngineKind;
  set: (partial: Partial<GameState>) => void;
  get: () => GameState;
}): Promise<void> {
  const selectedFormatId = formatId ?? deck.format ?? "standard";
  const format = getFormat(selectedFormatId);
  const startingLife = format?.deckRules.startingLife ?? DEFAULT_STARTING_LIFE;

  // On web, "Play vs AI" can be routed through a self-hosted-node room when
  // the deployment enables it: the node runs the engine and spawns the bot,
  // and the browser attaches as a non-host multiplayer client.
  if (
    getPlatform().type === "web" &&
    isHostedEngineAvailable() &&
    engine === "Forge" &&
    opponentDeck
  ) {
    set({
      isGameActive: true,
      fatalError: null,
      gameView: null,
      currentPrompt: null,
      gameLog: [],
      snapshots: [],
      deferredQueue: [],
      isFlashing: false,
      isWaitingForResponse: false,
      gameConfig: { formatId: selectedFormatId, startingLife },
      isPrefetchingCards: true,
      debugInfo: "Starting hosted Forge engine...",
    });
    const hosted = await startHostedAiGame({
      playerDeck: deck,
      opponentDeck,
      formatId: selectedFormatId,
      commanderName: commanderName ?? null,
    });
    resetSelectedGameRuntime();
    const hostedRuntime = getSelectedGameRuntime();
    const hostedDecks: Record<string, Deck> = {};
    hosted.playerOrder.forEach((_, index) => {
      hostedDecks[`player-${index}`] = hosted.decks[index];
    });
    set({
      isMultiplayer: true,
      isHost: false,
      myPlayerSlot: `player-${hosted.enginePlayerIndex}`,
      gameDecks: hostedDecks,
      debugInfo: "Joining hosted Forge engine...",
    });
    await hostedRuntime.api.startMultiplayerGame({
      playerNames: hosted.playerOrder,
      decks: hosted.decks,
      commanderNames: hosted.commanderNames,
      enginePlayerIndex: hosted.enginePlayerIndex,
      localIsHost: false,
      startingLife: hosted.startingLife,
    });
    set({ debugInfo: "Hosted Forge game started.", isPrefetchingCards: false });
    return;
  }

  const gameDecks: Record<string, Deck> = { "player-0": deck };
  if (opponentDeck) gameDecks["player-1"] = opponentDeck;
  const runtime = getSelectedGameRuntime();

  set({
    isGameActive: true,
    fatalError: null,
    gameView: null,
    currentPrompt: null,
    gameLog: [],
    snapshots: [],
    deferredQueue: [],
    isFlashing: false,
    isWaitingForResponse: false,
    gameConfig: { formatId: selectedFormatId, startingLife },
    gameDecks,
    isPrefetchingCards: true,
    debugInfo: "Starting engine...",
  });

  const result = await runtime.api.startGame({
    deck,
    startingLife,
    commanderName: commanderName ?? null,
    opponentDeck: opponentDeck ?? null,
  });
  set({ debugInfo: `Game started: ${result}.` });
}

export const useGameStore = create<GameState>()(
  devtools(
    (set, get) => ({
      gameView: null,
      currentPrompt: null,
      gameLog: [],
      snapshots: [],
      isGameActive: false,
      debugInfo: "",
      fatalError: null,
      isPrefetchingCards: false,
      deferredQueue: [],
      isFlashing: false,
      isWaitingForResponse: false,
      gameConfig: null,
      isMultiplayer: false,
      isHost: false,
      myPlayerSlot: null,
      gameDecks: {},

      updateGameView: (view) => set({ gameView: view }),

      setGameConfig: (config) => set({ gameConfig: config }),

      startGame: async (deck, formatId, commanderName, opponentDeck, engine) => {
        try {
          await initializeGame({ deck, opponentDeck, formatId, commanderName, engine, set, get });
        } catch (e) {
          set({ isGameActive: false, debugInfo: `Start failed: ${e}`, isPrefetchingCards: false });
          console.error("[store] Failed to start game:", e);
          toast.error(e instanceof Error ? e.message : "Failed to start game");
        }
      },

      startManualTabletopGame: async (deck, formatId, commanderName) => {
        selectGameRuntime("manual-tabletop");
        await get().startGame(deck, formatId ?? deck.format ?? "standard", commanderName);

        const runtime = getSelectedGameRuntime();
        if (!isManualTabletopApi(runtime)) return;
        const gameView = runtime.api.getGameView();
        if (!gameView) return;

        await runtime.api.applyManualAction({
          type: "replaceState",
          ...seedManualDeck(gameView, deck),
        });
        const prompt = await runtime.api.getPrompt();
        if (prompt) {
          applyPrompt(prompt as Prompt, "Manual", set, get);
        }
      },

      startManualRoomHost: async (localPlayerSlot: string) => {
        const runtime = getSelectedGameRuntime();
        if (!isManualTabletopApi(runtime)) {
          throw new Error("Manual room host requires the manual tabletop runtime.");
        }
        const roomHost = new BroadcastRoomHost({
          localPlayerSlot,
          mode: "authoritative-host",
          seats: [
            {
              kind: "local-human",
              playerSlot: localPlayerSlot,
              displayName: "You",
            },
          ],
        });
        startManualRoomSync({ roomHost, api: runtime.api });
        const gameView = runtime.api.getGameView();
        if (gameView) {
          await roomHost.broadcastManualState(gameView);
        }
        set({
          isMultiplayer: true,
          isHost: true,
          myPlayerSlot: localPlayerSlot,
          debugInfo: "Manual room host started.",
        });
      },

      startManualRoomClient: async (localPlayerSlot: string, initialGameView?: GameViewDto) => {
        selectGameRuntime("manual-tabletop");
        const runtime = getSelectedGameRuntime();
        if (!isManualTabletopApi(runtime)) {
          throw new Error("Manual room client requires the manual tabletop runtime.");
        }
        const roomHost = new BroadcastRoomHost({
          localPlayerSlot,
          mode: "relay-client",
          seats: [
            {
              kind: "local-human",
              playerSlot: localPlayerSlot,
              displayName: "You",
            },
          ],
        });
        startManualRoomSync({ roomHost, api: runtime.api });
        if (initialGameView) {
          await runtime.api.applyManualAction({
            type: "replaceState",
            gameView: initialGameView,
          });
          const prompt = await runtime.api.getPrompt();
          if (prompt) {
            applyPrompt(prompt as Prompt, "Manual", set, get);
          }
        }
        set({
          isGameActive: true,
          isMultiplayer: true,
          isHost: false,
          myPlayerSlot: localPlayerSlot,
          debugInfo: "Manual room client connected. Waiting for table state...",
        });
      },

      stopManualRoomSync: () => {
        stopActiveManualRoomSync();
      },

      startMultiplayerGame: async (
        playerNames,
        decks,
        commanderNames,
        enginePlayerIndex,
        localIsHost,
        startingLife,
      ) => {
        // Guard against re-entry — a second start while one is already in
        // flight would tear down the first session's response channels in
        // the engine (game_manager.rs sees a takeover and drops the txs),
        // causing every recv_action in game 1 to return Concede and any
        // user clicks made between the two starts to queue in game 2's
        // channel where they'll be misrouted by `await_display_ack`.
        if (get().isGameActive) {
          console.warn(
            "[store] startMultiplayerGame called while a game is already active — ignoring duplicate.",
          );
          return;
        }
        const gameDecks: Record<string, Deck> = {};
        decks.forEach((d, i) => {
          gameDecks[`player-${i}`] = d;
        });
        const server = useServerStore.getState();
        if (server.currentRoom) {
          armActiveGameSession({
            roomId: server.currentRoom.room_id,
            isHost: localIsHost,
            username: server.username ?? "",
          });
        }
        try {
          set({
            isGameActive: true,
            isMultiplayer: true,
            isHost: localIsHost,
            myPlayerSlot: `player-${enginePlayerIndex}`,
            gameView: null,
            currentPrompt: null,
            gameLog: [],
            snapshots: [],
            deferredQueue: [],
            isFlashing: false,
            isWaitingForResponse: false,
            debugInfo: "Starting multiplayer game...",
            isPrefetchingCards: true,
            gameDecks,
          });
          resetSelectedGameRuntime();
          const runtime = getSelectedGameRuntime();
          set({ debugInfo: "Starting engine..." });
          await runtime.api.startMultiplayerGame({
            playerNames,
            decks,
            commanderNames,
            enginePlayerIndex,
            localIsHost,
            startingLife,
          });
          set({ debugInfo: "Multiplayer game started.", isPrefetchingCards: false });
        } catch (e) {
          set({
            isGameActive: false,
            debugInfo: `Multiplayer start failed: ${e}`,
            isPrefetchingCards: false,
            gameDecks: {},
          });
          console.error("[store] Failed to start multiplayer game:", e);
          toast.error(e instanceof Error ? e.message : "Failed to start multiplayer game");
        }
      },

      respond: async (output) => {
        const promptType = get().currentPrompt?.input.type;
        if (!promptType) {
          console.warn("[store] respond() called with no active prompt");
          return;
        }
        const action = { type: promptType, output } as PromptOutput;
        // Single-prompt invariant: the engine sends exactly one prompt
        // at a time per agent and expects exactly one response. If a
        // response is already in flight, drop the duplicate — the modal
        // stays mounted briefly between ack send and the next prompt's
        // arrival (especially with multiplayer relay latency), so a
        // rapid second click would otherwise queue a stale action that
        // gets misrouted by the next recv on the engine side.
        //
        // Concede is the one exception: it must always go through to
        // tear down the session even mid-prompt.
        if (get().isWaitingForResponse && output.type !== "concede") {
          console.warn(`[store] respond(${output.type}) ignored — already waiting for a response`);
          return;
        }
        try {
          // Only explicit player actions (not passes) cancel auto-pass.
          if (output.type !== "pass") {
            usePhaseStopStore.getState().clearPassUntil();
          }
          set({ isWaitingForResponse: true, debugInfo: `Responding: ${output.type}` });
          const { myPlayerSlot } = get();
          const runtime = getSelectedGameRuntime();
          await runtime.api.respond({ action, playerSlot: myPlayerSlot });
        } catch (e) {
          set({ isWaitingForResponse: false, debugInfo: `Respond error: ${e}` });
          console.error("Failed to respond:", e);
        }
      },

      concede: async () => {
        const runtime = getSelectedGameRuntime();
        if (runtime.capabilities.concedeBehavior === "end-session") {
          void get().endGame();
          return;
        }
        // Await the concede send so the relay-bound message is on the wire
        // before we tear down the runtime / leave the room — otherwise the
        // host engine never sees the concede and waits out the 120 s
        // recv_timeout while the other players sit idle.
        try {
          await get().respond({ type: "concede" });
        } catch (e) {
          console.warn("[store] concede respond failed:", e);
        }
        // Conceding always exits the room: the player explicitly opted out
        // of the match, so don't strand them on the game-over screen
        // waiting for the GameOver prompt to round-trip.
        void get().endGame();
      },

      endGame: async () => {
        clearActiveGameSession();
        const runtime = getSelectedGameRuntime();
        const wasMultiplayer = get().isMultiplayer;
        set({
          isGameActive: false,
          gameView: null,
          currentPrompt: null,
          gameLog: [],
          snapshots: [],
          deferredQueue: [],
          isFlashing: false,
          isWaitingForResponse: false,
          isMultiplayer: false,
          isHost: false,
          myPlayerSlot: null,
          gameDecks: {},
        });
        stopActiveManualRoomSync();
        resetSelectedGameRuntime();
        const withTimeout = <T>(p: Promise<T>, label: string) =>
          Promise.race([
            p,
            new Promise<void>((resolve) =>
              setTimeout(() => {
                console.warn(`${label} timed out after 2s`);
                resolve();
              }, 2000),
            ),
          ]);
        try {
          await withTimeout(runtime.api.endGame(), "runtime.endGame()");
        } catch (e) {
          console.warn("runtime.endGame() failed:", e);
        }
        if (wasMultiplayer) {
          try {
            await withTimeout(useServerStore.getState().leaveRoom(), "leaveRoom()");
          } catch (e) {
            console.warn("Failed to leave multiplayer room after game end:", e);
          }
        }
      },

      setMultiplayerState: (isMultiplayer, isHost, myPlayerSlot) => {
        set({ isMultiplayer, isHost, myPlayerSlot });
      },

      restoreSnapshot: async (checkpointId) => {
        const { isMultiplayer, isHost } = get();
        if (isMultiplayer && !isHost) return;
        const promptType = get().currentPrompt?.input.type;
        if (promptType !== "chooseAction") {
          set({
            debugInfo: "Snapshot restore is only available during priority prompts.",
          });
          return;
        }
        const runtime = getSelectedGameRuntime();
        await runtime.api.restoreSnapshot({ checkpointId });
        set({ debugInfo: `Requested snapshot restore: #${checkpointId}` });
      },
    }),
    { name: "game", enabled: import.meta.env.DEV },
  ),
);

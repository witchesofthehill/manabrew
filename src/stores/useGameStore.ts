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
import { startHostedAiGame, startTauriForgeAiGame } from "@/game/hostedAiPlay";
import { getPlatform } from "@/platform";
import { applyPrompt } from "./gameStore.constants";
import { DEFAULT_STARTING_LIFE, useServerStore } from "./useServerStore";
import type { GameState } from "./gameStore.types";
import type { Prompt, PromptOutput } from "@/protocol";
import type { CardDto, GameViewDto } from "@/protocol/game";
import type { Deck, DeckCard } from "@/protocol/deck";
import type { EngineKind } from "@/types/server";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import type { GameRuntime, ManualTabletopApi } from "@/game";

export type { GameConfig, GameState, DisplayEvent, DeferredSnapshot } from "./gameStore.types";

function isManualTabletopApi(
  runtime: GameRuntime,
): runtime is GameRuntime & { api: ManualTabletopApi } {
  return runtime.capabilities.manualTabletop && "applyManualAction" in runtime.api;
}

function manualZoneCard(card: DeckCard, playerId: string, zoneId: string): CardDto {
  const { identity, ...rest } = card;
  return {
    ...GAME_CARD_DEFAULTS,
    ...rest,
    id: `manual-card-${crypto.randomUUID()}`,
    identity: {
      name: identity.name,
      setCode: identity.setCode,
      cardNumber: identity.cardNumber,
      isToken: false,
    },
    foil: identity.foil ?? false,
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

  // "Play vs AI" against Forge never runs in-process: a self-hosted node hosts
  // the room and spawns the bot while the client attaches as a non-host
  // multiplayer player. On web this uses a pooled hosted room gated by the
  // deployment flag; on the Tauri graalvm build the desktop app hosts the Forge
  // room locally. If the local Forge host can't start, fall back to the
  // in-process Manabrew engine so the game still launches.
  const platformType = getPlatform().type;
  if (
    engine === "Forge" &&
    opponentDeck &&
    (platformType === "tauri" || (platformType === "web" && isHostedEngineAvailable()))
  ) {
    const launchForge = platformType === "tauri" ? startTauriForgeAiGame : startHostedAiGame;
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
      relinquishedPriority: false,
      gameConfig: { formatId: selectedFormatId, startingLife },
      isPrefetchingCards: true,
      debugInfo: "Starting Forge engine...",
    });
    try {
      const hosted = await launchForge({
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
        debugInfo: "Joining Forge engine...",
      });
      await hostedRuntime.api.startMultiplayerGame({
        playerNames: hosted.playerOrder,
        decks: hosted.decks,
        commanderNames: hosted.commanderNames,
        enginePlayerIndex: hosted.enginePlayerIndex,
        localIsHost: false,
        startingLife: hosted.startingLife,
      });
      set({ debugInfo: "Forge game started.", isPrefetchingCards: false });
      return;
    } catch (error) {
      if (platformType !== "tauri") throw error;
      console.error("[store] Forge host unavailable; falling back to Manabrew:", error);
      toast.error("Forge engine unavailable — using the Manabrew engine.");
      resetSelectedGameRuntime();
      set({ isMultiplayer: false, isHost: false });
    }
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
    relinquishedPriority: false,
    selfConceded: false,
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
      relinquishedPriority: false,
      gameConfig: null,
      selfConceded: false,
      isMultiplayer: false,
      isHost: false,
      myPlayerSlot: null,
      gameDecks: {},
      hiddenPlaymats: new Set<string>(),

      togglePlaymatHidden: (playerId) =>
        set((state) => {
          const next = new Set(state.hiddenPlaymats);
          if (next.has(playerId)) next.delete(playerId);
          else next.add(playerId);
          return { hiddenPlaymats: next };
        }),

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
            gameId: server.gameId,
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
            relinquishedPriority: false,
            selfConceded: false,
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
        if (get().isWaitingForResponse) {
          console.warn(`[store] respond(${output.type}) ignored — already waiting for a response`);
          return;
        }
        // A pass / empty combat declaration relinquishes priority: reflect
        // "waiting for others" optimistically, before the engine state lags in.
        const relinquishedPriority =
          output.type === "pass" ||
          ((output.type === "declareAttackers" || output.type === "declareBlockers") &&
            output.assignments.length === 0);
        try {
          set({
            isWaitingForResponse: true,
            relinquishedPriority,
            debugInfo: `Responding: ${output.type}`,
          });
          const { myPlayerSlot } = get();
          const runtime = getSelectedGameRuntime();
          await runtime.api.respond({ action, playerSlot: myPlayerSlot });
        } catch (e) {
          set({
            isWaitingForResponse: false,
            relinquishedPriority: false,
            debugInfo: `Respond error: ${e}`,
          });
          console.error("Failed to respond:", e);
        }
      },

      concede: async () => {
        const runtime = getSelectedGameRuntime();
        if (runtime.capabilities.concedeBehavior === "end-session") {
          void get().endGame();
          return;
        }
        const { myPlayerSlot } = get();
        set({ selfConceded: true, currentPrompt: null, isWaitingForResponse: false });
        if (!myPlayerSlot) return;
        try {
          await runtime.api.sendDirective({
            playerSlot: myPlayerSlot,
            directive: { type: "concede" },
          });
        } catch (e) {
          console.warn("[store] concede directive failed:", e);
        }
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
          relinquishedPriority: false,
          selfConceded: false,
          isMultiplayer: false,
          isHost: false,
          myPlayerSlot: null,
          gameDecks: {},
          hiddenPlaymats: new Set<string>(),
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
        if (wasMultiplayer) {
          try {
            await withTimeout(useServerStore.getState().leaveRoom(), "leaveRoom()");
          } catch (e) {
            console.warn("Failed to leave multiplayer room after game end:", e);
          }
        }
        try {
          await withTimeout(runtime.api.endGame(), "runtime.endGame()");
        } catch (e) {
          console.warn("runtime.endGame() failed:", e);
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

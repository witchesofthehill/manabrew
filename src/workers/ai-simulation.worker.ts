import init, { WasmManabot } from "../wasm/wasm";
import { createForgeEngine } from "@forge-wasm/forge.js";
import type { Deck } from "../protocol/deck";
import type { Prompt, PromptOutput, StateUpdate } from "../protocol";
import type {
  AiSimulationGameResult,
  AiSimulationSeatStats,
  AiSimulationSummary,
  AiSimulationWorkerMessage,
} from "../game/aiSimulation.types";

interface StartRequest {
  type: "start";
  decks: Deck[];
  games: number;
  startingLife: number;
  seedBase: number;
}

type WorkerRequest = StartRequest | { type: "cancel" };

interface GameOutcome {
  reason: string;
  message?: string;
}

interface GameViewSnapshot {
  turn?: number;
  winnerId?: string | null;
}

function blankSeatStats(): AiSimulationSeatStats {
  return {
    prompts: 0,
    casts: 0,
    landPlays: 0,
    abilities: 0,
    passes: 0,
    attackers: 0,
    blocks: 0,
    mulligans: 0,
    promptTypes: {},
    actionLabels: {},
    cardUses: {},
  };
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function findDeckCardByLabel(
  deck: Deck,
  label: string | undefined,
): Deck["cards"][number] | undefined {
  if (!label) return undefined;
  return [...deck.cards, ...(deck.commanders ?? [])]
    .filter((card) => card.identity.name && label.includes(card.identity.name))
    .sort((left, right) => right.identity.name.length - left.identity.name.length)[0];
}

function percentile(values: number[], fraction: number): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]);
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function aggregate(
  decks: Deck[],
  requestedGames: number,
  results: AiSimulationGameResult[],
): AiSimulationSummary {
  const deckTotals = decks.map(() => ({
    games: 0,
    wins: 0,
    prompts: 0,
    casts: 0,
    landPlays: 0,
    abilities: 0,
    passes: 0,
    attackers: 0,
    blocks: 0,
    mulligans: 0,
    promptTypes: {} as Record<string, number>,
    actionLabels: {} as Record<string, number>,
    cardUses: {} as Record<string, number>,
  }));
  const seatWins = decks.map((_, seat) => ({ seat, wins: 0, games: 0 }));
  const turns: number[] = [];
  const durations: number[] = [];
  const responseLatencies = results.flatMap((result) => result.responseLatencies);
  let decidedGames = 0;

  for (const result of results) {
    durations.push(result.durationMs);
    if (result.turns > 0) turns.push(result.turns);

    for (const seat of result.seats) {
      const total = deckTotals[seat.deckIndex];
      if (!total) continue;
      total.games += 1;
      seatWins[seat.deckIndex]!.games += 1;
      for (const key of [
        "prompts",
        "casts",
        "landPlays",
        "abilities",
        "passes",
        "attackers",
        "blocks",
        "mulligans",
      ] as const) {
        total[key] += seat.stats[key];
      }
      for (const [key, value] of Object.entries(seat.stats.promptTypes)) {
        total.promptTypes[key] = (total.promptTypes[key] ?? 0) + value;
      }
      for (const [key, value] of Object.entries(seat.stats.actionLabels)) {
        total.actionLabels[key] = (total.actionLabels[key] ?? 0) + value;
      }
      for (const [cardId, count] of Object.entries(seat.stats.cardUses)) {
        total.cardUses[cardId] = (total.cardUses[cardId] ?? 0) + count;
      }
    }

    if (result.winnerDeckIndex !== null) {
      decidedGames += 1;
      const winner = deckTotals[result.winnerDeckIndex];
      if (winner) winner.wins += 1;
      if (result.winnerSeat !== null && seatWins[result.winnerSeat]) {
        seatWins[result.winnerSeat]!.wins += 1;
      }
    }
  }

  return {
    requestedGames,
    completedGames: results.length,
    decidedGames,
    nonResults: results.length - decidedGames,
    averageTurns: turns.length
      ? Number((turns.reduce((sum, value) => sum + value, 0) / turns.length).toFixed(1))
      : 0,
    medianTurns: median(turns),
    averageDurationMs: durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : 0,
    medianDurationMs: median(durations),
    responseLatencyP50: percentile(responseLatencies, 0.5),
    responseLatencyP90: percentile(responseLatencies, 0.9),
    responseLatencyP99: percentile(responseLatencies, 0.99),
    decks: decks.map((deck, deckIndex) => {
      const total = deckTotals[deckIndex]!;
      const average = (key: keyof typeof total) => {
        const value = total[key];
        return typeof value === "number" && total.games
          ? Number((value / total.games).toFixed(1))
          : 0;
      };
      return {
        deckIndex,
        name: deck.name || `Deck ${deckIndex + 1}`,
        games: total.games,
        wins: total.wins,
        winRate: total.games ? Number(((total.wins / total.games) * 100).toFixed(1)) : 0,
        average: {
          prompts: average("prompts"),
          casts: average("casts"),
          landPlays: average("landPlays"),
          abilities: average("abilities"),
          passes: average("passes"),
          attackers: average("attackers"),
          blocks: average("blocks"),
          mulligans: average("mulligans"),
        },
        promptTypes: total.promptTypes,
        actionLabels: total.actionLabels,
        cardUses: total.cardUses,
      };
    }),
    seatWins,
    results,
  };
}

function seatIndex(playerSlot?: string): number {
  if (!playerSlot) return 0;
  const value = Number(playerSlot.slice("player-".length));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

let cancelRequested = false;
let running = false;
let cancelActiveGame: (() => void) | null = null;

function post(message: AiSimulationWorkerMessage): void {
  self.postMessage(message);
}

async function playOneGame(
  decks: Deck[],
  deckOrder: number[],
  gameNumber: number,
  seed: number,
  startingLife: number,
): Promise<AiSimulationGameResult> {
  const orderedDecks = deckOrder.map((index) => decks[index]!);
  const bots: WasmManabot[] = [];
  const seatStats = orderedDecks.map(() => blankSeatStats());
  const latencySamples: number[] = [];
  const finalView = { current: null as GameViewSnapshot | null };
  let turns = 0;
  const startedAt = performance.now();
  let resolveOutcome!: (outcome: GameOutcome) => void;
  let settled = false;
  const ended = new Promise<GameOutcome>((resolve) => {
    resolveOutcome = resolve;
  });
  const finish = (outcome: GameOutcome) => {
    if (settled) return;
    settled = true;
    resolveOutcome(outcome);
  };

  const engine = await createForgeEngine({
    onState: (state: StateUpdate, playerSlot?: string) => {
      const index = seatIndex(playerSlot);
      const bot = bots[index];
      if (bot) bot.observe_state?.(JSON.stringify(state));
      if (index === 0) {
        const view = (state as unknown as { gameView?: GameViewSnapshot }).gameView;
        if (view) {
          finalView.current = view;
          turns = Math.max(turns, view.turn ?? 0);
        }
      }
    },
    onPrompt: (prompt: Prompt, playerSlot?: string) => {
      if (cancelRequested) return;
      const index = seatIndex(playerSlot);
      const bot = bots[index];
      const stats = seatStats[index];
      if (!bot || !stats) return;
      stats.prompts += 1;
      const input = prompt.input as unknown as {
        type?: string;
        actions?: Array<{
          id?: string;
          type?: string;
          label?: string;
          description?: string;
          cardId?: string;
        }>;
      };
      increment(stats.promptTypes, input.type ?? "unknown");
      const decisionStartedAt = performance.now();
      const raw = bot.decide(JSON.stringify(prompt));
      latencySamples.push(performance.now() - decisionStartedAt);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        output?: {
          type?: string;
          actionId?: string;
          assignments?: unknown[];
          keep?: boolean;
        };
      };
      const decision = parsed.output;
      if (!decision) return;
      if (decision.type === "act") {
        const selected = input.actions?.find((action) => action.id === decision.actionId);
        const label = selected?.label ?? selected?.description;
        if (label) increment(stats.actionLabels, label);
        if (selected?.type === "cast") {
          stats.casts += 1;
          if ((selected.label ?? "").startsWith("Play ")) stats.landPlays += 1;
          const deckCard = findDeckCardByLabel(orderedDecks[index]!, selected.label);
          const cardKey = deckCard?.identity.id || deckCard?.identity.name;
          if (cardKey) increment(stats.cardUses, cardKey);
        } else {
          stats.abilities += 1;
        }
      } else if (decision.type === "pass") {
        stats.passes += 1;
      } else if (decision.type === "declareAttackers") {
        stats.attackers += decision.assignments?.length ?? 0;
      } else if (decision.type === "declareBlockers") {
        stats.blocks += decision.assignments?.length ?? 0;
      } else if (decision.type === "mulliganDecision" && !decision.keep) {
        stats.mulligans += 1;
      }
      const promptId = Number(prompt.promptId);
      if (!Number.isSafeInteger(promptId)) {
        finish({ reason: "invalid_prompt_id", message: "Forge returned a prompt without a numeric ID." });
        return;
      }
      engine.respond(promptId, parsed as unknown as PromptOutput, playerSlot);
    },
    onEvent: (event: string, _payload: unknown) => {
      if (event === "game:over" || event === "game:forced_end") {
        finish({ reason: event });
      }
    },
    onError: (error: unknown) => finish({ reason: "engine_error", message: String(error) }),
  });

  bots.push(...orderedDecks.map(() => new WasmManabot()));
  const abort = () => {
    engine.dispose();
    finish({ reason: "cancelled" });
  };
  cancelActiveGame = abort;
  const timeout = setTimeout(() => finish({ reason: "timeout" }), 900_000);

  try {
    let outcome: GameOutcome;
    try {
      if (cancelRequested) abort();
      else {
        await engine.startMultiplayerGame({
          decks: orderedDecks,
          playerNames: orderedDecks.map((_, index) => `Manabot ${index + 1}`),
          commanderNames: orderedDecks.map(
            (deck) => deck.commanders?.[0]?.identity?.name ?? null,
          ),
          enginePlayerIndex: 0,
          botSeats: orderedDecks.map((_, index) => index).filter((index) => index !== 0),
          startingLife,
          seed,
          snapshotRecording: false,
          decisionJournal: false,
          journalRewind: false,
        });
      }
      outcome = await ended;
    } catch (error) {
      if (!cancelRequested) throw error;
      outcome = { reason: "cancelled" };
    }
    const winnerId = finalView.current?.winnerId ?? null;
    const winnerSeat = winnerId?.startsWith("player-")
      ? Number(winnerId.slice("player-".length))
      : null;
    const validWinner =
      winnerSeat !== null && Number.isInteger(winnerSeat) && winnerSeat >= 0 && winnerSeat < decks.length;
    return {
      game: gameNumber,
      seed,
      outcome: outcome.reason,
      winnerSeat: validWinner ? winnerSeat : null,
      winnerDeckIndex: validWinner ? deckOrder[winnerSeat] ?? null : null,
      turns,
      durationMs: Math.round(performance.now() - startedAt),
      responseLatencyP50: percentile(latencySamples, 0.5),
      responseLatencyP90: percentile(latencySamples, 0.9),
      responseLatencyP99: percentile(latencySamples, 0.99),
      responseLatencies: latencySamples,
      seats: seatStats.map((stats, seat) => ({ deckIndex: deckOrder[seat]!, stats })),
    };
  } finally {
    clearTimeout(timeout);
    cancelActiveGame = null;
    engine.dispose();
    for (const bot of bots) bot.free();
  }
}

async function runSimulation(request: StartRequest): Promise<void> {
  if (running) return;
  running = true;
  cancelRequested = false;
  try {
    if (request.decks.length < 2) throw new Error("Choose at least two decks.");
    await init();
    const games = Math.max(1, Math.min(250, Math.floor(request.games)));
    const results: AiSimulationGameResult[] = [];
    for (let index = 0; index < games; index += 1) {
      if (cancelRequested) break;
      const rotation = index % request.decks.length;
      const deckOrder = request.decks.map((_, at) => (at + rotation) % request.decks.length);
      const result = await playOneGame(
        request.decks,
        deckOrder,
        index + 1,
        request.seedBase + index,
        request.startingLife,
      );
      if (result.outcome === "cancelled") break;
      results.push(result);
      post({
        type: "progress",
        completed: results.length,
        total: games,
        lastGame: result,
      });
    }
    const summary = aggregate(request.decks, games, results);
    if (cancelRequested) post({ type: "cancelled", summary });
    else post({ type: "complete", summary });
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
    cancelActiveGame = null;
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === "cancel") {
    cancelRequested = true;
    cancelActiveGame?.();
    return;
  }
  void runSimulation(event.data);
};

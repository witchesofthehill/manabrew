import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/protocol/deck";
import type {
  AiSimulationSummary,
  AiSimulationWorkerMessage,
} from "@/game/aiSimulation.types";

export interface AiSimulationPanelProps {
  decks: Deck[];
  games: number;
  startingLife: number;
  onClose: () => void;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-ui-meta text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function AiSimulationPanel({
  decks,
  games,
  startingLife,
  onClose,
}: AiSimulationPanelProps) {
  const workerRef = useRef<Worker | null>(null);
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(games);
  const [lastGame, setLastGame] = useState<string>("");
  const [summary, setSummary] = useState<AiSimulationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL("../../workers/ai-simulation.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<AiSimulationWorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") {
        setCompleted(message.completed);
        setTotal(message.total);
        setLastGame(
          message.lastGame.winnerDeckIndex === null
            ? `Game ${message.lastGame.game}: no winner (${message.lastGame.outcome})`
            : `Game ${message.lastGame.game}: ${decks[message.lastGame.winnerDeckIndex]?.name ?? "Unknown deck"} won`,
        );
      } else if (message.type === "complete" || message.type === "cancelled") {
        setSummary(message.summary);
        setCompleted(message.summary.completedGames);
        setTotal(message.summary.requestedGames);
        setCancelRequested(message.type === "cancelled");
      } else {
        setError(message.message);
      }
    };
    worker.onerror = (event) => setError(event.message || "The simulation worker failed.");
    worker.postMessage({
      type: "start",
      decks,
      games,
      startingLife,
      seedBase: Math.floor(Date.now() / 1000),
    });
    return () => {
      worker.postMessage({ type: "cancel" });
      worker.terminate();
      workerRef.current = null;
    };
  }, [decks, games, startingLife]);

  function cancel(): void {
    setCancelRequested(true);
    workerRef.current?.postMessage({ type: "cancel" });
  }

  const running = !summary && !error;
  const progress = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-background/90 p-3 backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-simulation-title"
        className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b px-4 py-3 sm:px-6">
          <div>
            <h2 id="ai-simulation-title" className="text-lg font-semibold">
              AI deck simulation
            </h2>
            <p className="text-ui-meta text-muted-foreground">
              {games} games · Forge engine · Manabot seats
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-ui-label">
              <span>{summary ? "Simulation finished" : cancelRequested ? "Cancelling…" : "Running games"}</span>
              <span className="tabular-nums">{completed} / {total}</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={completed}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
            {lastGame && <p className="text-ui-meta text-muted-foreground">{lastGame}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {summary && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Decided games" value={`${summary.decidedGames} / ${summary.completedGames}`} />
                <Stat label="Non-results" value={summary.nonResults} />
                <Stat label="Average / median turns" value={`${summary.averageTurns} / ${summary.medianTurns}`} />
                <Stat label="Average game duration" value={formatDuration(summary.averageDurationMs)} />
                <Stat label="Median game duration" value={formatDuration(summary.medianDurationMs)} />
                <Stat label="Decision p50 / p90 / p99" value={`${summary.responseLatencyP50} / ${summary.responseLatencyP90} / ${summary.responseLatencyP99} ms`} />
              </div>

              <section className="space-y-2">
                <h3 className="font-semibold">Results by deck</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-muted/60 text-ui-meta text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Deck</th>
                        <th className="px-3 py-2">Wins</th>
                        <th className="px-3 py-2">Win rate</th>
                        <th className="px-3 py-2">Games</th>
                        <th className="px-3 py-2">Casts / game</th>
                        <th className="px-3 py-2">Attacks / game</th>
                        <th className="px-3 py-2">Blocks / game</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.decks.map((deck) => (
                        <tr key={deck.deckIndex} className="border-t">
                          <td className="px-3 py-2 font-medium">{deck.name}</td>
                          <td className="px-3 py-2 tabular-nums">{deck.wins}</td>
                          <td className="px-3 py-2 tabular-nums">{deck.winRate}%</td>
                          <td className="px-3 py-2 tabular-nums">{deck.games}</td>
                          <td className="px-3 py-2 tabular-nums">{deck.average.casts}</td>
                          <td className="px-3 py-2 tabular-nums">{deck.average.attackers}</td>
                          <td className="px-3 py-2 tabular-nums">{deck.average.blocks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold">Seat balance</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {summary.seatWins.map((seat) => (
                    <Stat
                      key={seat.seat}
                      label={`Seat ${seat.seat + 1}`}
                      value={`${seat.wins} wins / ${seat.games} games`}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold">Action profile by deck</h3>
                {summary.decks.map((deck) => {
                  const actions = Object.entries(deck.actionLabels)
                    .sort((left, right) => right[1] - left[1])
                    .slice(0, 8);
                  const promptTypes = Object.entries(deck.promptTypes)
                    .sort((left, right) => right[1] - left[1]);
                  return (
                    <div key={deck.deckIndex} className="rounded-lg border p-3">
                      <div className="font-medium">{deck.name}</div>
                      <div className="mt-1 text-ui-meta text-muted-foreground">
                        Avg prompts {deck.average.prompts} · lands {deck.average.landPlays} ·
                        abilities {deck.average.abilities} · mulligans {deck.average.mulligans} ·
                        passes {deck.average.passes}
                      </div>
                      {actions.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {actions.map(([label, count]) => (
                            <span key={label} className="rounded-md bg-muted px-2 py-1 text-ui-meta">
                              {label}: {count}
                            </span>
                          ))}
                        </div>
                      )}
                      {promptTypes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {promptTypes.map(([type, count]) => (
                            <span key={type} className="rounded-md border px-2 py-1 text-ui-meta text-muted-foreground">
                              {type}: {count}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold">Game log</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="bg-muted/60 text-ui-meta text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Game</th>
                        <th className="px-3 py-2">Winner</th>
                        <th className="px-3 py-2">Turns</th>
                        <th className="px-3 py-2">Duration</th>
                        <th className="px-3 py-2">Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.results.map((game) => (
                        <tr key={game.game} className="border-t">
                          <td className="px-3 py-2 tabular-nums">{game.game}</td>
                          <td className="px-3 py-2">
                            {game.winnerDeckIndex === null
                              ? "—"
                              : summary.decks[game.winnerDeckIndex]?.name}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{game.turns}</td>
                          <td className="px-3 py-2 tabular-nums">{formatDuration(game.durationMs)}</td>
                          <td className="px-3 py-2">{game.outcome}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t px-4 py-3 sm:px-6">
          {running && (
            <Button variant="outline" onClick={cancel} disabled={cancelRequested}>
              Cancel simulation
            </Button>
          )}
          <Button variant="primary" onClick={onClose} disabled={running && !cancelRequested}>
            {running ? "Running…" : "Close"}
          </Button>
        </footer>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Clock3,
  Gauge,
  ShieldAlert,
  Swords,
  Timer,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScryfallImg } from "@/components/ScryfallImg";
import type { Deck, DeckCard } from "@/protocol/deck";
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

type StatTone = "default" | "green" | "amber" | "blue";

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function Stat({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon: LucideIcon;
  tone?: StatTone;
}) {
  const toneClass = {
    default: "border-border bg-card",
    green: "border-emerald-500/25 bg-emerald-500/5",
    amber: "border-amber-500/25 bg-amber-500/5",
    blue: "border-sky-500/25 bg-sky-500/5",
  }[tone];
  const iconClass = {
    default: "text-muted-foreground",
    green: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    blue: "text-sky-600 dark:text-sky-400",
  }[tone];

  return (
    <div className={`min-w-0 rounded-xl border px-3 py-3 ${toneClass}`}>
      <div className="flex items-center gap-2 text-ui-meta text-muted-foreground">
        <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
        <span>{label}</span>
      </div>
      <div className="mt-2 break-words text-xl font-bold tabular-nums tracking-tight">{value}</div>
      {detail && <div className="mt-1 text-ui-meta text-muted-foreground">{detail}</div>}
    </div>
  );
}

function cardKey(card: DeckCard): string {
  return card.identity.id || card.identity.name;
}

function resolveUsedCards(deck: Deck | undefined, uses: Record<string, number>) {
  if (!deck) return [];
  const deckCards = [...deck.cards, ...(deck.commanders ?? [])];
  return Object.entries(uses)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .flatMap(([key, count]) => {
      const card = deckCards.find((candidate) => cardKey(candidate) === key);
      return card ? [{ card, count }] : [];
    });
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
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BarChart3 className="h-4 w-4" />
              </span>
              <h2 id="ai-simulation-title" className="text-lg font-semibold">
                AI simulation report
              </h2>
            </div>
            <p className="mt-1 pl-10 text-ui-meta text-muted-foreground">
              {games} games · {decks.length} decks · {startingLife} starting life
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          <section className="rounded-xl border bg-card/60 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3 text-ui-label">
              <div className="flex items-center gap-2 font-semibold">
                <Activity className="h-4 w-4 text-primary" />
                <span>{summary ? "Simulation completed" : cancelRequested ? "Cancelling simulation…" : "Running simulation"}</span>
              </div>
              <span className="shrink-0 font-semibold tabular-nums">{completed} / {total}</span>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-ui-meta text-muted-foreground">
                {lastGame || (running ? "Preparing the first game…" : "Results are ready")}
              </p>
              {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            </div>
          </section>

          {summary && (
            <>
              <section className="space-y-3">
                <div>
                  <h3 className="font-semibold">At a glance</h3>
                  <p className="text-ui-meta text-muted-foreground">Overall performance across the completed sample</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                  <Stat
                    label="Decided games"
                    value={`${summary.decidedGames} / ${summary.completedGames}`}
                    detail={summary.completedGames ? `${((summary.decidedGames / summary.completedGames) * 100).toFixed(1)}% with a winner` : "No completed games"}
                    icon={Trophy}
                    tone="green"
                  />
                  <Stat
                    label="No result"
                    value={summary.nonResults}
                    detail="Games without a winner"
                    icon={ShieldAlert}
                    tone="amber"
                  />
                  <Stat
                    label="Average turns"
                    value={summary.averageTurns}
                    detail={`Median ${summary.medianTurns} turns`}
                    icon={Activity}
                    tone="blue"
                  />
                  <Stat
                    label="Average duration"
                    value={formatDuration(summary.averageDurationMs)}
                    detail={`Median ${formatDuration(summary.medianDurationMs)}`}
                    icon={Clock3}
                  />
                  <Stat
                    label="Decision p50"
                    value={`${summary.responseLatencyP50} ms`}
                    detail={`p90 ${summary.responseLatencyP90} ms`}
                    icon={Timer}
                  />
                  <Stat
                    label="Decision p99"
                    value={`${summary.responseLatencyP99} ms`}
                    detail="Slowest 1% of decisions"
                    icon={Gauge}
                  />
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">Deck standings</h3>
                    <p className="text-ui-meta text-muted-foreground">Win rate is calculated against each deck’s completed games</p>
                  </div>
                  <span className="text-ui-meta font-medium text-muted-foreground">{summary.decks.length} decks</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {summary.decks.map((deck) => {
                    const sourceDeck = decks[deck.deckIndex];
                    const cover = sourceDeck?.commanders?.[0] ?? sourceDeck?.cards?.[0];
                    return (
                      <article key={deck.deckIndex} className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
                        <div className="flex gap-3">
                          <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                            {cover?.uris?.normal ? (
                              <ScryfallImg
                                src={cover.uris.normal}
                                alt={cover.identity.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-ui-meta text-muted-foreground">
                                <Swords className="h-5 w-5" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h4 className="truncate font-semibold">{deck.name}</h4>
                                <p className="mt-1 text-ui-meta text-muted-foreground">
                                  {deck.wins} wins · {deck.games} games
                                </p>
                              </div>
                              <div className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-right">
                                <div className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{deck.winRate}%</div>
                                <div className="text-ui-meta text-emerald-700/80 dark:text-emerald-400/80">win rate</div>
                              </div>
                            </div>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-emerald-500 transition-[width]"
                                style={{ width: `${Math.max(0, Math.min(100, deck.winRate))}%` }}
                              />
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-2 text-ui-meta">
                              <div>
                                <div className="font-semibold tabular-nums">{deck.average.casts}</div>
                                <div className="text-muted-foreground">casts / game</div>
                              </div>
                              <div>
                                <div className="font-semibold tabular-nums">{deck.average.attackers}</div>
                                <div className="text-muted-foreground">attacks / game</div>
                              </div>
                              <div>
                                <div className="font-semibold tabular-nums">{deck.average.blocks}</div>
                                <div className="text-muted-foreground">blocks / game</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <h3 className="font-semibold">Seat balance</h3>
                  <p className="text-ui-meta text-muted-foreground">Checks whether turn order gives one seat an advantage</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {summary.seatWins.map((seat) => {
                    const winRate = seat.games ? (seat.wins / seat.games) * 100 : 0;
                    return (
                      <div key={seat.seat} className="rounded-xl border bg-card px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-ui-meta text-muted-foreground">Seat {seat.seat + 1}</span>
                          <span className="font-semibold tabular-nums">{winRate.toFixed(1)}%</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-sky-500" style={{ width: `${winRate}%` }} />
                        </div>
                        <p className="mt-2 text-ui-meta text-muted-foreground">{seat.wins} wins / {seat.games} games</p>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <h3 className="font-semibold">How each deck played</h3>
                  <p className="text-ui-meta text-muted-foreground">Action volume and most frequent decisions, with averages per game</p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {summary.decks.map((deck) => {
                    const actions = Object.entries(deck.actionLabels)
                      .sort((left, right) => right[1] - left[1])
                      .slice(0, 6);
                    const actionMax = Math.max(1, ...actions.map((entry) => entry[1]));
                    const promptTypes = Object.entries(deck.promptTypes)
                      .sort((left, right) => right[1] - left[1]);
                    return (
                      <article key={deck.deckIndex} className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
                        <h4 className="font-semibold">{deck.name}</h4>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          {[
                            ["Lands", deck.average.landPlays],
                            ["Abilities", deck.average.abilities],
                            ["Mulligans", deck.average.mulligans],
                            ["Prompts", deck.average.prompts],
                            ["Passes", deck.average.passes],
                            ["Casts", deck.average.casts],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded-lg bg-muted/60 px-2 py-2">
                              <div className="font-semibold tabular-nums">{value}</div>
                              <div className="text-ui-meta text-muted-foreground">{label} / game</div>
                            </div>
                          ))}
                        </div>
                        {actions.length > 0 && (
                          <div className="mt-4 space-y-2">
                            <div className="text-ui-label font-medium">Most frequent actions</div>
                            {actions.map(([label, count]) => (
                              <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                                <span className="truncate text-ui-meta" title={label}>{label}</span>
                                <span className="text-ui-meta font-semibold tabular-nums">{count}</span>
                                <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-sky-500"
                                    style={{ width: `${(count / actionMax) * 100}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {promptTypes.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {promptTypes.slice(0, 6).map(([type, count]) => (
                              <span key={type} className="rounded-md border px-2 py-1 text-ui-meta text-muted-foreground">
                                {type} · {count}
                              </span>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <h3 className="font-semibold">Most cast cards</h3>
                  <p className="text-ui-meta text-muted-foreground">Card images are matched against the cards in each simulated deck</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {summary.decks.map((deck) => {
                    const usedCards = resolveUsedCards(decks[deck.deckIndex], deck.cardUses);
                    return (
                      <article key={deck.deckIndex} className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
                        <h4 className="mb-3 font-semibold">{deck.name}</h4>
                        {usedCards.length > 0 ? (
                          <div className="flex flex-wrap gap-3">
                            {usedCards.map(({ card, count }) => (
                              <div key={cardKey(card)} className="w-[72px]">
                                <div className="aspect-[5/7] overflow-hidden rounded-lg bg-muted shadow-sm">
                                  <ScryfallImg
                                    src={card.uris.normal}
                                    alt={card.identity.name}
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                                <div className="mt-1 line-clamp-2 min-h-8 text-ui-meta font-medium" title={card.identity.name}>
                                  {card.identity.name}
                                </div>
                                <div className="text-ui-meta font-bold tabular-nums text-sky-700 dark:text-sky-400">{count} casts</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-ui-meta text-muted-foreground">No cast cards could be matched in this sample.</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>

              <details className="group rounded-xl border bg-card">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 font-semibold sm:px-4">
                  <span>Game log <span className="ml-1 text-ui-meta font-normal text-muted-foreground">({summary.results.length} games)</span></span>
                  <span className="text-ui-meta text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
                </summary>
                <div className="overflow-x-auto border-t">
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
                      {summary.results.map((game) => {
                        const hasWinner = game.winnerDeckIndex !== null;
                        return (
                          <tr key={game.game} className="border-t">
                            <td className="px-3 py-2 tabular-nums">{game.game}</td>
                            <td className={`px-3 py-2 font-medium ${hasWinner ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                              {hasWinner ? summary.decks[game.winnerDeckIndex!]?.name : "No winner"}
                            </td>
                            <td className="px-3 py-2 tabular-nums">{game.turns}</td>
                            <td className="px-3 py-2 tabular-nums">{formatDuration(game.durationMs)}</td>
                            <td className="px-3 py-2 text-muted-foreground">{game.outcome}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
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

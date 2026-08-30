/**
 * How long an engine takes to answer, measured where the player feels it: from
 * the client sending an answer to the next prompt landing.
 *
 * Engine-agnostic on purpose. The hosted node publishes its own decision
 * timings to Prometheus, but nothing measures the engines that run on the
 * player's machine, and a number is only worth having if both sides are
 * measured the same way. This is that number, summarised once per game rather
 * than streamed: one report, no per-decision traffic, nothing about the cards.
 */
export interface Turnaround {
  n: number;
  p50: number;
  p90: number;
  max: number;
}

export interface EngineGameStats {
  /** Client-generated, so a retry cannot double-count the game. */
  reportId: string;
  /** Which engine actually ran; recorded at launch, see `beginGame`. */
  engine: string;
  clientVersion: string;
  platform: string;
  format: string | null;
  seats: number;
  multiplayer: boolean;
  durationS: number;
  endReason: "gameOver" | "left" | "error";
  /** Client-side turnaround: answer sent to next prompt. */
  turnaround: Turnaround;
  /** The engine's own think time, when it reports one (Forge in the browser). */
  engineThink: Turnaround | null;
  /** Turnaround per prompt type, biggest first, capped so a report stays small. */
  byType: Array<{ type: string; n: number; p50: number; max: number }>;
}

interface Sample {
  ms: number;
  type: string;
}

// A long game is a few hundred decisions; the cap is only there so a runaway
// session cannot grow without bound.
const MAX_SAMPLES = 4000;
const MAX_TYPES = 12;

let samples: Sample[] = [];
let engineThink: number[] = [];
let answeredAt: number | null = null;
let startedAtMs: number | null = null;
let engineLabel = "unknown";

/** Percentiles over a copy, so the caller's array keeps its order. */
export function summarise(values: number[]): Turnaround {
  if (values.length === 0) return { n: 0, p50: 0, p90: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))];
  return {
    n: sorted.length,
    p50: Math.round(at(50)),
    p90: Math.round(at(90)),
    max: Math.round(sorted[sorted.length - 1]),
  };
}

export function byPromptType(
  entries: Sample[],
): Array<{ type: string; n: number; p50: number; max: number }> {
  const grouped = new Map<string, number[]>();
  for (const sample of entries) {
    const list = grouped.get(sample.type);
    if (list) list.push(sample.ms);
    else grouped.set(sample.type, [sample.ms]);
  }
  return [...grouped.entries()]
    .map(([type, values]) => {
      const stat = summarise(values);
      return { type, n: stat.n, p50: stat.p50, max: stat.max };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_TYPES);
}

/**
 * Start the clock for one game, and record which engine is about to run it.
 *
 * The label belongs here rather than at the end because only the launch knows
 * it: a hosted game runs Forge on a node while the client still drives the
 * relay through the Manabrew runtime, and the launch resets that runtime on the
 * way in. Read afterwards, every hosted game looks like the Rust engine.
 */
export function beginGame(engine: string): void {
  samples = [];
  engineThink = [];
  answeredAt = null;
  startedAtMs = Date.now();
  engineLabel = engine;
}

export function noteAnswerSent(): void {
  answeredAt = performance.now();
}

export function notePromptArrived(promptType: string): void {
  // No pending answer means the engine spoke first (the opening prompt, or a
  // resync), which is not a turnaround.
  if (answeredAt === null) return;
  const ms = performance.now() - answeredAt;
  answeredAt = null;
  if (samples.length < MAX_SAMPLES) samples.push({ ms, type: promptType });
}

export function noteEngineThinkTime(ms: number): void {
  if (engineThink.length < MAX_SAMPLES) engineThink.push(ms);
}

export function summariseGame(meta: {
  clientVersion: string;
  platform: string;
  format: string | null;
  seats: number;
  multiplayer: boolean;
  endReason: EngineGameStats["endReason"];
  reportId: string;
}): EngineGameStats | null {
  // A game nobody played says nothing about how fast the engine is.
  if (startedAtMs === null || samples.length < 5) return null;
  const stats: EngineGameStats = {
    reportId: meta.reportId,
    engine: engineLabel,
    clientVersion: meta.clientVersion,
    platform: meta.platform,
    format: meta.format,
    seats: meta.seats,
    multiplayer: meta.multiplayer,
    durationS: Math.round((Date.now() - startedAtMs) / 1000),
    endReason: meta.endReason,
    turnaround: summarise(samples.map((s) => s.ms)),
    engineThink: engineThink.length ? summarise(engineThink) : null,
    byType: byPromptType(samples),
  };
  startedAtMs = null;
  return stats;
}

import { releaseCardRaster, retainCardRaster } from "@/lib/cardRenderTypes";
import type { CardRaster } from "@/lib/cardRenderTypes";
import { CARD_WORKER_COUNT } from "@/lib/cardCompositionWorker";

export type CardRenderPriority = "preview" | "visible" | "background";

interface Consumer {
  resolve: (raster: CardRaster) => void;
  reject: (error: unknown) => void;
  detach: () => void;
}

interface Composition {
  key: string;
  run: (signal: AbortSignal) => Promise<CardRaster>;
  controller: AbortController;
  priority: CardRenderPriority;
  queuedAt: number;
  started: boolean;
  consumers: Set<Consumer>;
}

const PRIORITY: Record<CardRenderPriority, number> = { preview: 0, visible: 1, background: 2 };
const MAX_QUEUED = 128;
const pending = new Map<string, Composition>();
const active = new Set<Composition>();
let scheduled = false;
const counters = {
  deduplicated: 0,
  compositions: 0,
  cancelled: 0,
  compositionMs: 0,
  queueWaitMs: 0,
  queueOverflows: 0,
};

export function cardQueueStats() {
  return {
    ...counters,
    active: active.size,
    queued: [...pending.values()].filter((job) => !job.started).length,
  };
}

export function resetCardQueueStats(): void {
  counters.deduplicated = 0;
  counters.compositions = 0;
  counters.cancelled = 0;
  counters.compositionMs = 0;
  counters.queueWaitMs = 0;
  counters.queueOverflows = 0;
}

function schedule(): void {
  if (active.size >= CARD_WORKER_COUNT || scheduled || pending.size === 0) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    void drain();
  }, 0);
}

async function drain(): Promise<void> {
  let next: Composition | undefined;
  for (const job of pending.values()) {
    if (job.started) continue;
    if (!next || PRIORITY[job.priority] < PRIORITY[next.priority]) next = job;
  }
  if (!next) return;
  if (
    next.priority === "background" &&
    [...active].some((running) => running.priority === "background")
  )
    return;
  const job = next;
  active.add(job);
  job.started = true;
  schedule();
  const start = performance.now();
  counters.queueWaitMs += start - job.queuedAt;
  counters.compositions += 1;
  let raster: CardRaster | undefined;
  try {
    raster = await job.run(job.controller.signal);
    job.controller.signal.throwIfAborted();
    for (const consumer of job.consumers) {
      retainCardRaster(raster);
      consumer.resolve(raster);
    }
  } catch (error) {
    for (const consumer of job.consumers) consumer.reject(error);
  } finally {
    if (raster) releaseCardRaster(raster);
    for (const consumer of job.consumers) consumer.detach();
    counters.compositionMs += performance.now() - start;
    if (pending.get(job.key) === job) pending.delete(job.key);
    active.delete(job);
    schedule();
  }
}

export function enqueueCardRender(
  key: string,
  run: (signal: AbortSignal) => Promise<CardRaster>,
  priority: CardRenderPriority,
  signal?: AbortSignal,
): Promise<CardRaster> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  let job = pending.get(key);
  if (job) {
    counters.deduplicated += 1;
    if (PRIORITY[priority] < PRIORITY[job.priority]) job.priority = priority;
  } else {
    if (pending.size >= MAX_QUEUED + active.size) {
      let displaced: Composition | undefined;
      for (const candidate of pending.values()) {
        if (candidate.started || PRIORITY[candidate.priority] < PRIORITY[priority]) continue;
        if (!displaced || PRIORITY[candidate.priority] > PRIORITY[displaced.priority])
          displaced = candidate;
      }
      counters.queueOverflows++;
      if (!displaced) return Promise.reject(new Error("Card composition queue is full"));
      const error = new DOMException(
        "Card rendering displaced by newer visible work",
        "AbortError",
      );
      pending.delete(displaced.key);
      displaced.controller.abort(error);
      for (const consumer of displaced.consumers) {
        consumer.detach();
        consumer.reject(error);
      }
      displaced.consumers.clear();
    }
    job = {
      key,
      run,
      priority,
      controller: new AbortController(),
      queuedAt: performance.now(),
      started: false,
      consumers: new Set(),
    };
    pending.set(key, job);
  }
  const composition = job;
  const promise = new Promise<CardRaster>((resolve, reject) => {
    const abort = () => {
      composition.consumers.delete(consumer);
      consumer.detach();
      counters.cancelled += 1;
      const error = signal?.reason ?? new DOMException("Card rendering cancelled", "AbortError");
      reject(error);
      if (composition.consumers.size === 0) {
        if (pending.get(key) === composition) pending.delete(key);
        composition.controller.abort(error);
      }
    };
    const consumer: Consumer = {
      resolve,
      reject,
      detach: () => signal?.removeEventListener("abort", abort),
    };
    composition.consumers.add(consumer);
    signal?.addEventListener("abort", abort, { once: true });
  });
  schedule();
  return promise;
}

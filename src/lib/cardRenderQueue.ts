import type { CardCanvas } from "@/lib/cardRenderTypes";

export type CardRenderPriority = "preview" | "visible" | "background";

interface Consumer {
  resolve: (canvas: CardCanvas) => void;
  reject: (error: unknown) => void;
  detach: () => void;
}

interface Composition {
  key: string;
  run: () => Promise<CardCanvas>;
  priority: CardRenderPriority;
  queuedAt: number;
  started: boolean;
  consumers: Set<Consumer>;
}

const PRIORITY: Record<CardRenderPriority, number> = { preview: 0, visible: 1, background: 2 };
const pending = new Map<string, Composition>();
let active = false;
let scheduled = false;
const counters = {
  deduplicated: 0,
  compositions: 0,
  cancelled: 0,
  compositionMs: 0,
  queueWaitMs: 0,
};

export function cardQueueStats() {
  return { ...counters, active: Number(active), queued: pending.size - Number(active) };
}

export function resetCardQueueStats(): void {
  counters.deduplicated = 0;
  counters.compositions = 0;
  counters.cancelled = 0;
  counters.compositionMs = 0;
  counters.queueWaitMs = 0;
}

function schedule(): void {
  if (active || scheduled || pending.size === 0) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    void drain();
  }, 0);
}

async function drain(): Promise<void> {
  let next: Composition | undefined;
  for (const job of pending.values()) {
    if (!next || PRIORITY[job.priority] < PRIORITY[next.priority]) next = job;
  }
  if (!next) return;
  const job = next;
  active = true;
  job.started = true;
  const start = performance.now();
  counters.queueWaitMs += start - job.queuedAt;
  counters.compositions += 1;
  try {
    const canvas = await job.run();
    for (const consumer of job.consumers) consumer.resolve(canvas);
  } catch (error) {
    for (const consumer of job.consumers) consumer.reject(error);
  } finally {
    for (const consumer of job.consumers) consumer.detach();
    counters.compositionMs += performance.now() - start;
    pending.delete(job.key);
    active = false;
    schedule();
  }
}

export function enqueueCardRender(
  key: string,
  run: () => Promise<CardCanvas>,
  priority: CardRenderPriority,
  signal?: AbortSignal,
): Promise<CardCanvas> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  let job = pending.get(key);
  if (job) {
    counters.deduplicated += 1;
    if (PRIORITY[priority] < PRIORITY[job.priority]) job.priority = priority;
  } else {
    job = { key, run, priority, queuedAt: performance.now(), started: false, consumers: new Set() };
    pending.set(key, job);
  }
  const composition = job;
  const promise = new Promise<CardCanvas>((resolve, reject) => {
    const abort = () => {
      composition.consumers.delete(consumer);
      consumer.detach();
      counters.cancelled += 1;
      reject(signal?.reason ?? new DOMException("Card rendering cancelled", "AbortError"));
      if (!composition.started && composition.consumers.size === 0) pending.delete(key);
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

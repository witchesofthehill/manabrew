export type CardGpuScope = "pixi" | "dom" | "native";

interface CardGpuStats {
  supported: boolean | null;
  samples: number;
  totalMs: number;
  discarded: number;
  skipped: number;
  pending: number;
}

interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export interface CardGpuTimer {
  begin(): void;
  end(): void;
  reset(): void;
  destroy(): void;
}

const MAX_PENDING_QUERIES = 8;
const scopes: Record<CardGpuScope, CardGpuStats> = {
  pixi: { supported: null, samples: 0, totalMs: 0, discarded: 0, skipped: 0, pending: 0 },
  dom: { supported: null, samples: 0, totalMs: 0, discarded: 0, skipped: 0, pending: 0 },
  native: { supported: null, samples: 0, totalMs: 0, discarded: 0, skipped: 0, pending: 0 },
};
const timers = new Set<CardGpuTimer>();
let profilingUsers = 0;

export function acquireCardGpuProfiling(): () => void {
  profilingUsers++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--profilingUsers === 0) for (const timer of timers) timer.reset();
  };
}

export function getCardGpuTimingStats(scope: CardGpuScope) {
  const stats = scopes[scope];
  return {
    ...stats,
    gpuTimingAvailable: stats.supported === true,
    gpuCompletionMs: stats.samples ? stats.totalMs / stats.samples : null,
  };
}

export function createCardGpuTimer(gl: WebGL2RenderingContext, scope: CardGpuScope): CardGpuTimer {
  const stats = scopes[scope];
  const pending: WebGLQuery[] = [];
  const free: WebGLQuery[] = [];
  let extension: TimerExtension | null | undefined;
  let active: WebGLQuery | undefined;
  let destroyed = false;
  let collectionFrame = 0;
  const reset = () => {
    cancelAnimationFrame(collectionFrame);
    collectionFrame = 0;
    if (!gl.isContextLost()) {
      if (active && extension) gl.endQuery(extension.TIME_ELAPSED_EXT);
      if (active) gl.deleteQuery(active);
      for (const query of pending) gl.deleteQuery(query);
      for (const query of free) gl.deleteQuery(query);
    }
    stats.discarded += pending.length + Number(Boolean(active));
    stats.pending -= pending.length;
    pending.length = free.length = 0;
    active = undefined;
    extension = undefined;
  };
  const collect = (): boolean => {
    if (!extension) return false;
    if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
      stats.discarded += pending.length;
      stats.pending -= pending.length;
      for (const query of pending) free.push(query);
      pending.length = 0;
      return false;
    }
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = pending.shift()!;
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      stats.pending--;
      if (Number.isFinite(nanoseconds) && nanoseconds >= 0) {
        stats.samples++;
        stats.totalMs += nanoseconds / 1_000_000;
      } else stats.discarded++;
      free.push(query);
    }
    return true;
  };
  const scheduleCollection = (): void => {
    if (collectionFrame) return;
    collectionFrame = requestAnimationFrame(() => {
      collectionFrame = 0;
      if (destroyed || !profilingUsers || gl.isContextLost()) {
        reset();
        return;
      }
      collect();
      if (pending.length) scheduleCollection();
    });
  };
  const timer: CardGpuTimer = {
    begin() {
      if (destroyed || !profilingUsers || active) return;
      if (gl.isContextLost()) {
        reset();
        return;
      }
      if (extension === undefined) {
        extension = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null;
        stats.supported = stats.supported === true || !!extension;
      }
      if (!extension) return;
      if (!collect()) return;
      if (
        pending.length >= MAX_PENDING_QUERIES ||
        gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)
      ) {
        stats.skipped++;
        return;
      }
      const query = free.pop() ?? gl.createQuery();
      if (!query) {
        stats.skipped++;
        return;
      }
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      active = query;
    },
    end() {
      if (!active || !extension) return;
      if (gl.isContextLost()) {
        reset();
        return;
      }
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pending.push(active);
      stats.pending++;
      active = undefined;
      scheduleCollection();
    },
    reset,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      reset();
      timers.delete(timer);
    },
  };
  timers.add(timer);
  return timer;
}

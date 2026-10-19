import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CardRenderRequest } from "@/lib/cardRenderSnapshot";
import {
  clearCardRenderCache,
  getCardRenderDecision,
  getCardRenderStats,
  renderCard,
} from "@/lib/cardRenderer";
import { CardRenderError } from "@/lib/cardRenderDecision";

import { releaseCardRaster, type CardRenderTier } from "@/lib/cardRenderTypes";
import { getCardFinishStats } from "@/lib/cardFinishResources";
import { getCardInspectStats } from "@/lib/cardGlintInspect";
import { getCardFoilBatchStats } from "@/pixi/effects/cardFoilBatch";
import { getDomCardFoilStats } from "@/lib/cardFoilDom";
import { acquireCardGpuProfiling } from "@/lib/cardRenderGpuTiming";

function captureStats() {
  return {
    composition: getCardRenderStats(),
    finishPreparation: getCardFinishStats(),
    nativeInspector: getCardInspectStats(),
    pixiBatches: getCardFoilBatchStats(),
    domOutputs: getDomCardFoilStats(),
  };
}
interface Sample {
  mode: "cold" | "warm";
  durationMs: number;
  outcome: string;
  tier: CardRenderTier;
}

export function CardRenderingProfile({
  request,
  onRemount,
}: {
  request: CardRenderRequest;
  onRemount: () => void;
}) {
  const [stats, setStats] = useState(captureStats);
  const [tier, setTier] = useState<CardRenderTier>("inspect");
  const longTasks = useRef({ supported: false, count: 0, totalMs: 0, longestMs: 0 });
  const [decision, setDecision] = useState("Preparing presentation decision…");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const releaseGpuProfiling = acquireCardGpuProfiling();
    const supported = PerformanceObserver.supportedEntryTypes.includes("longtask");
    longTasks.current.supported = supported;
    const observer = supported
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.current.count++;
            longTasks.current.totalMs += entry.duration;
            longTasks.current.longestMs = Math.max(longTasks.current.longestMs, entry.duration);
          }
        })
      : null;
    observer?.observe({ type: "longtask" });
    const timer = window.setInterval(() => setStats(captureStats()), 500);
    return () => {
      releaseGpuProfiling();
      window.clearInterval(timer);
      observer?.disconnect();
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void renderCard(request, undefined, { tier })
      .then((canvas) => {
        try {
          const next = getCardRenderDecision(canvas);
          if (!cancelled) setDecision(JSON.stringify(next));
        } finally {
          releaseCardRaster(canvas);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setDecision(
            cause instanceof CardRenderError
              ? JSON.stringify(cause.decision)
              : `Rendering failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
      });
    return () => {
      cancelled = true;
      controller.current?.abort();
    };
  }, [request, tier]);
  const measure = async (mode: "cold" | "warm") => {
    if (mode === "cold" && !clearCardRenderCache()) {
      setMessage(
        "Renderer busy. Wait for queued work to finish before clearing finished-card caches.",
      );
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setMessage("");
    const start = performance.now();
    let outcome = "generated";
    try {
      const raster = await renderCard(request, abort.signal, { tier });
      releaseCardRaster(raster);
    } catch (cause) {
      outcome = cause instanceof Error ? cause.message : String(cause);
    }
    if (abort.signal.aborted) {
      setBusy(false);
      return;
    }
    setSamples((current) => [
      ...current.slice(-11),
      { mode, tier, durationMs: performance.now() - start, outcome },
    ]);
    setStats(captureStats());
    setBusy(false);
    onRemount();
  };
  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      aria-label="Card Glint diagnostics"
      data-card-renderer="card-glint"
    >
      <h2 className="font-semibold">Presentation decision and measured cache behavior</h2>
      <output data-testid="render-decision" className="block break-all font-mono text-xs">
        {decision}
      </output>
      <p className="text-xs text-muted-foreground">
        Card Glint composes generated frames, not exact historical printings. A cold sample clears
        finished generated cards, not downloaded assets, fonts, or browser caches. Timings measure
        this renderer request, not GPU presentation. Native submissions, Pixi batches and separate
        DOM outputs are counted independently. Long tasks cover this profiler session, not an
        isolated card request. GPU timing is opt-in while this panel is mounted and reports the mean
        of valid completed asynchronous timer queries per presentation. Unsupported contexts report
        no GPU time; disjoint samples are discarded. CPU submission is not GPU time or FPS, and GPU
        query time is not presentation latency.
      </p>
      <div className="flex flex-wrap gap-2">
        {(["table", "native", "inspect"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={tier === value ? "secondary" : "outline"}
            aria-pressed={tier === value}
            disabled={busy}
            onClick={() => setTier(value)}
          >
            {value}
          </Button>
        ))}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void measure("cold")}>
          Measure cold card cache
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void measure("warm")}>
          Measure warm request
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {busy ? "Measuring…" : message}
      </p>
      <pre
        data-testid="renderer-stats"
        className="max-h-48 overflow-auto rounded bg-muted p-3 text-xs"
      >
        {JSON.stringify({ ...stats, mainThreadLongTasks: longTasks.current }, null, 2)}
      </pre>
      <output
        data-testid="render-samples"
        className="block max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs"
      >
        {JSON.stringify(samples, null, 2)}
      </output>
    </section>
  );
}

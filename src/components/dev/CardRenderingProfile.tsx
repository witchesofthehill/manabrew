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

interface Sample {
  mode: "cold" | "warm";
  durationMs: number;
  outcome: string;
}

export function CardRenderingProfile({
  request,
  onRemount,
}: {
  request: CardRenderRequest;
  onRemount: () => void;
}) {
  const [stats, setStats] = useState(getCardRenderStats);
  const [decision, setDecision] = useState("Preparing presentation decision…");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setStats(getCardRenderStats()), 500);
    return () => {
      window.clearInterval(timer);
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void renderCard(request)
      .then((canvas) => {
        const next = getCardRenderDecision(canvas);
        if (!cancelled) setDecision(JSON.stringify(next));
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
  }, [request]);
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
      await renderCard(request, abort.signal);
    } catch (cause) {
      outcome = cause instanceof Error ? cause.message : String(cause);
    }
    if (abort.signal.aborted) {
      setBusy(false);
      return;
    }
    setSamples((current) => [
      ...current.slice(-11),
      { mode, durationMs: performance.now() - start, outcome },
    ]);
    setStats(getCardRenderStats());
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
        this renderer request, not GPU presentation.
      </p>
      <div className="flex flex-wrap gap-2">
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
        {JSON.stringify(stats, null, 2)}
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

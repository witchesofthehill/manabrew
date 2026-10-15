import { useEffect, useRef, useState } from "react";
import { selectMsePresentation } from "@mse-renderer";
import { Button } from "@/components/ui/button";
import { captureMseCardInput, prepareMseCard, type MseCardRequest } from "@/lib/mseCardSnapshot";
import { clearMseRenderCache, getMseRenderStats, renderMseCard } from "@/lib/mseCardRenderer";
import { MseCardRenderError } from "@/lib/mseCardDecision";

interface Sample {
  mode: "cold" | "warm";
  durationMs: number;
  outcome: string;
}

export function CardRenderingProfile({
  request,
  onRemount,
}: {
  request: MseCardRequest;
  onRemount: () => void;
}) {
  const [stats, setStats] = useState(getMseRenderStats);
  const [decision, setDecision] = useState("Preparing presentation decision…");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setStats(getMseRenderStats()), 500);
    return () => {
      window.clearInterval(timer);
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void prepareMseCard(captureMseCardInput(request))
      .then(({ snapshot, faceIndex }) => {
        const next = selectMsePresentation(snapshot, { faceIndex }).decision;
        if (!cancelled) setDecision(JSON.stringify(next));
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setDecision(
            cause instanceof MseCardRenderError
              ? JSON.stringify(cause.decision)
              : `Preparation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
      });
    return () => {
      cancelled = true;
      controller.current?.abort();
    };
  }, [request]);
  const measure = async (mode: "cold" | "warm") => {
    if (mode === "cold" && !clearMseRenderCache()) {
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
      await renderMseCard(request, abort.signal);
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
    setStats(getMseRenderStats());
    setBusy(false);
    onRemount();
  };
  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      aria-label="Renderer diagnostics"
    >
      <h2 className="font-semibold">Presentation decision and measured cache behavior</h2>
      <output data-testid="render-decision" className="block break-all font-mono text-xs">
        {decision}
      </output>
      <p className="text-xs text-muted-foreground">
        Native template selection is not a promise of exact printing fidelity. A cold sample clears
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

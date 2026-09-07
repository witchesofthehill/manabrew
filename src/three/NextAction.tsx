import { useEffect, useRef, useState } from "react";
import { nextButtonShader } from "@/three/nextButtonShader";
import type { AutoPassCountdown } from "@/three/arena.types";

export function NextAction({
  label,
  busy,
  onNext,
  countdown,
  onHoldPriority,
}: {
  label: string;
  busy: boolean;
  onNext: () => void;
  countdown?: AutoPassCountdown | null;
  onHoldPriority?: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const progress = useRef<HTMLSpanElement>(null);
  const [passing, setPassing] = useState(false);
  const [caption, setCaption] = useState(label);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setPassing(Boolean(countdown)), countdown ? 0 : 160);
    return () => clearTimeout(timer);
  }, [countdown, busy]);
  useEffect(() => {
    if (!countdown || !progress.current) return;
    const elapsed = Math.max(0, performance.now() - countdown.startedAt);
    const animation = progress.current.animate(
      [
        { transform: `scaleX(${Math.min(1, elapsed / countdown.duration)})` },
        { transform: "scaleX(1)" },
      ],
      { duration: Math.max(1, countdown.duration - elapsed), easing: "linear", fill: "forwards" },
    );
    return () => animation.cancel();
  }, [countdown]);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaiting(busy), busy ? 700 : 0);
    return () => clearTimeout(timer);
  }, [busy]);
  useEffect(() => nextButtonShader(canvas.current!), []);
  useEffect(() => {
    if (busy) return;
    const timer = window.setTimeout(() => setCaption(label), 200);
    return () => clearTimeout(timer);
  }, [label, busy]);
  return (
    <div className="duel-next-action" data-counting={Boolean(countdown) || passing}>
      <button
        className="duel-arena-next"
        data-waiting={waiting && !countdown && !passing}
        aria-label={
          countdown
            ? "Hold priority"
            : waiting
              ? "Waiting for priority"
              : caption === "Resolve"
                ? "Resolve"
                : "Next"
        }
        aria-disabled={busy && !countdown}
        aria-busy={busy && !countdown}
        title={
          countdown
            ? "Click to stop auto-pass and enter full control"
            : waiting
              ? "Waiting for priority"
              : "Advance priority (Space)"
        }
        onClick={() => {
          if (countdown) onHoldPriority?.();
          else if (!busy) onNext();
        }}
      >
        <canvas ref={canvas} aria-hidden="true" />
        <span className="duel-next-word">
          {countdown || passing ? "Passing" : caption === "Resolve" ? "Resolve" : "Next"}
        </span>
        <span className="duel-autopass-track" aria-hidden="true">
          <span ref={progress} />
        </span>
        <svg
          className="duel-wait-hourglass"
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 3h12M6 21h12M7 3v4c0 2 3 3 5 5-2 2-5 3-5 5v4M17 3v4c0 2-3 3-5 5 2 2 5 3 5 5v4M9 6h6l-3 3zM9 18l3-3 3 3z" />
        </svg>
      </button>
      <small data-waiting={waiting && !countdown && !passing}>
        {countdown || passing
          ? "Click to hold priority"
          : caption === "Resolve"
            ? "Top of stack"
            : caption}
      </small>
    </div>
  );
}

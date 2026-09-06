import { useEffect, useRef, useState } from "react";
import { nextButtonShader } from "@/three/nextButtonShader";

export function NextAction({ label, busy, onNext }: { label: string; busy: boolean; onNext: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [caption, setCaption] = useState(label);
  const [waiting, setWaiting] = useState(false);
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
    <div className="duel-next-action">
      <button className="duel-arena-next" data-waiting={waiting} aria-label={waiting ? "Waiting for priority" : caption === "Resolve" ? "Resolve" : "Next"} aria-disabled={busy} aria-busy={busy} title={waiting ? "Waiting for priority" : "Advance priority (Space)"} onClick={() => { if (!busy) onNext(); }}>
        <canvas ref={canvas} aria-hidden="true" />
        <span className="duel-next-word">{caption === "Resolve" ? "Resolve" : "Next"}</span>
        <svg className="duel-wait-hourglass" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3h12M6 21h12M7 3v4c0 2 3 3 5 5-2 2-5 3-5 5v4M17 3v4c0 2-3 3-5 5 2 2 5 3 5 5v4M9 6h6l-3 3zM9 18l3-3 3 3z" />
        </svg>
      </button>
      <small data-waiting={waiting}>{caption === "Resolve" ? "Top of stack" : caption}</small>
    </div>
  );
}

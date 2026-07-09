import { useEffect, useRef, useState } from "react";
import { Check, Circle, Copy, Loader2 } from "lucide-react";
import { useGameStore } from "@/stores/useGameStore";
import { formatCommsLog } from "@/lib/commsLog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STUCK_HINT_AFTER_MS = 10_000;
const STEP_MIN_MS = 200;

const STEPS = [
  "Start the game engine",
  "Load card images",
  "Take your seat",
  "Receive the first game state",
];

interface GameLoadingScreenProps {
  debugInfo: string;
  onComplete?: () => void;
}

export function GameLoadingScreen({ debugInfo, onComplete }: GameLoadingScreenProps) {
  const isPrefetchingCards = useGameStore((s) => s.isPrefetchingCards);
  const hasGameView = useGameStore((s) => s.gameView !== null);
  const seated = useGameStore((s) => (s.gameView?.players?.length ?? 0) > 0);
  const endGame = useGameStore((s) => s.endGame);
  const lastAdvanceAt = useRef(0);
  const [stage, setStage] = useState(0);
  const [slow, setSlow] = useState(false);
  const [copied, setCopied] = useState(false);

  let target = 0;
  if (/started/i.test(debugInfo)) target = STEPS.length - 1;
  if (hasGameView && !isPrefetchingCards && seated) target = STEPS.length;

  useEffect(() => {
    lastAdvanceAt.current = Date.now();
    const timer = setTimeout(() => setSlow(true), STUCK_HINT_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (stage !== STEPS.length) return;
    onComplete?.();
  }, [stage, onComplete]);

  useEffect(() => {
    if (stage === target) return;
    const backwards = stage > target;
    const wait = backwards ? 0 : Math.max(0, STEP_MIN_MS - (Date.now() - lastAdvanceAt.current));
    const timer = setTimeout(() => {
      lastAdvanceAt.current = Date.now();
      setStage((current) => (backwards ? target : current + 1));
    }, wait);
    return () => clearTimeout(timer);
  }, [stage, target]);

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(formatCommsLog());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("Failed to copy logs:", e);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
      <div className="space-y-1.5 text-center">
        <p className="text-2xl font-semibold">Game starting…</p>
        <p className="text-base text-muted-foreground">
          {slow
            ? "This is taking longer than expected. You can keep waiting, or leave and return to the lobby."
            : "Setting the table — this usually takes a few seconds."}
        </p>
      </div>

      <div className="w-full max-w-lg rounded-xl border bg-card/50 px-6 py-4 text-left">
        <div className="flex items-center justify-between pb-3">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Setup progress
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground"
            onClick={() => void copyLogs()}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy logs"}
          </Button>
        </div>
        <ul className="space-y-3">
          {STEPS.map((label, index) => {
            const done = index < stage;
            const active = index === stage;
            return (
              <li key={label} className="flex items-center gap-3">
                {done ? (
                  <Check className="h-5 w-5 shrink-0 text-success" />
                ) : active ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                ) : (
                  <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                )}
                <span
                  className={cn(
                    "text-base transition-colors",
                    done && "text-success",
                    active && "text-foreground",
                    !done && !active && "text-muted-foreground/60",
                  )}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ul>
        {slow && debugInfo && (
          <p className="truncate border-t pt-3 mt-4 font-mono text-xs text-muted-foreground">
            {debugInfo}
          </p>
        )}
      </div>

      <Button variant="outline" onClick={() => void endGame()}>
        Leave game
      </Button>
    </div>
  );
}

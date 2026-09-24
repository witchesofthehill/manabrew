import { useEffect, useRef, useState } from "react";
import { Check, Circle, Copy, Loader2 } from "lucide-react";
import { useGameStore } from "@/stores/useGameStore";
import { formatCommsLog } from "@/lib/commsLog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GameLoadingTip } from "./GameLoadingTip";
import { useIsMobileGame, useIsTouch } from "@/hooks/useBreakpoints";

const STUCK_HINT_AFTER_MS = 10_000;
const STEP_MIN_MS = 200;
const STEPS = [
  `Start the game engine`,
  `Load card images`,
  `Take your seat`,
  `Receive the first game state`,
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
  const isTouch = useIsTouch();
  const compactLandscape = useIsMobileGame();
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
    if (stage >= target) return;
    const wait = Math.max(0, STEP_MIN_MS - (Date.now() - lastAdvanceAt.current));
    const timer = setTimeout(() => {
      lastAdvanceAt.current = Date.now();
      setStage((current) => current + 1);
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
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-6 px-6 py-6",
        isTouch &&
          "[padding-bottom:max(1.5rem,var(--safe-area-inset-bottom))] [padding-left:max(1.5rem,var(--safe-area-inset-left))] [padding-right:max(1.5rem,var(--safe-area-inset-right))] [padding-top:max(1.5rem,var(--safe-area-inset-top))]",
        compactLandscape &&
          "grid grid-cols-[minmax(8.5rem,0.65fr)_minmax(0,1.35fr)] grid-rows-[1fr_auto] items-center gap-x-4 gap-y-2 overflow-y-auto py-2 [padding-bottom:max(0.5rem,var(--safe-area-inset-bottom))] [padding-left:max(1rem,var(--safe-area-inset-left))] [padding-right:max(1rem,var(--safe-area-inset-right))] [padding-top:max(0.5rem,var(--safe-area-inset-top))]",
      )}
    >
      <div
        className={cn(
          "space-y-1.5 text-center",
          compactLandscape && "col-start-1 row-start-1 self-end space-y-1 text-left",
        )}
      >
        <p className={cn("text-2xl font-semibold", compactLandscape && "text-xl")}>
          Game starting…
        </p>
        <p
          className={cn(
            "text-base text-muted-foreground",
            compactLandscape && "text-sm leading-snug",
          )}
        >
          {slow
            ? `This is taking longer than expected. You can keep waiting, or leave and return to the lobby.`
            : `Setting the table \u2014 this usually takes a few seconds.`}
        </p>
      </div>

      <div
        className={cn(
          "w-full max-w-lg overflow-hidden rounded-xl border bg-card/50 text-left shadow-xl",
          compactLandscape && "col-start-2 row-span-2 row-start-1 max-w-2xl rounded-lg",
        )}
      >
        <div className={cn("px-6 py-4", compactLandscape && "px-4 py-3")}>
          <div className={cn("flex items-center justify-between pb-3", compactLandscape && "pb-2")}>
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Setup progress
            </p>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 gap-1.5 px-2.5 text-xs text-muted-foreground",
                isTouch && "min-h-11",
                compactLandscape && "px-2",
              )}
              onClick={() => void copyLogs()}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy logs"}
            </Button>
          </div>
          <ul className={cn("space-y-3", compactLandscape && "space-y-2")}>
            {STEPS.map((step, index) => {
              const label = step;
              const done = index < stage;
              const active = index === stage;
              return (
                <li key={label} className="flex items-center gap-3">
                  {done ? (
                    <Check
                      className={cn("h-5 w-5 shrink-0 text-success", compactLandscape && "h-4 w-4")}
                    />
                  ) : active ? (
                    <Loader2
                      className={cn(
                        "h-5 w-5 shrink-0 animate-spin text-primary motion-reduce:animate-none",
                        compactLandscape && "h-4 w-4",
                      )}
                    />
                  ) : (
                    <Circle
                      className={cn(
                        "h-5 w-5 shrink-0 text-muted-foreground/40",
                        compactLandscape && "h-4 w-4",
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "text-base transition-colors",
                      compactLandscape && "text-sm",
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
            <p
              className={cn(
                "mt-4 truncate border-t pt-3 font-mono text-xs text-muted-foreground",
                compactLandscape && "mt-2 pt-2",
              )}
            >
              {debugInfo}
            </p>
          )}
        </div>
        <GameLoadingTip compact={compactLandscape} />
      </div>

      <Button
        variant="outline"
        className={cn(
          isTouch && "min-h-11",
          compactLandscape && "col-start-1 row-start-2 self-start justify-self-start",
        )}
        onClick={() => void endGame()}
      >
        Leave game
      </Button>
    </div>
  );
}

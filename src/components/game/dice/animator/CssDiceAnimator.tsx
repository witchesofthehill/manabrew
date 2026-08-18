import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { DiceRollAnimationProps } from "../types";
import { DieFaceStatic } from "../DieFaceStatic";

const DWELL_AFTER_ANIMATION_MS = 350;
/** Must match the `--animate-dice-roll` duration in `src/index.css`. */
const ANIMATION_DURATION_MS = 2000;

interface DieAnimationParams {
  spinDeg: number;
  delayMs: number;
}

export function CssDiceAnimator({
  spec,
  onComplete,
  accentColor,
  className,
}: DiceRollAnimationProps) {
  const ignored = spec.ignoredRolls ?? [];
  const finals = spec.finalResults;

  // Stable randomized motion per die — generated once via lazy init so
  // re-renders don't re-roll the spin direction mid-animation.
  const totalDice = finals.length + ignored.length;
  const [params] = useState<DieAnimationParams[]>(() =>
    Array.from({ length: totalDice }, generateParams),
  );

  const completedRef = useRef(false);

  useEffect(() => {
    if (!onComplete) return;
    completedRef.current = false;
    const timeout = window.setTimeout(() => {
      if (completedRef.current) return;
      completedRef.current = true;
      onComplete();
    }, ANIMATION_DURATION_MS + DWELL_AFTER_ANIMATION_MS);
    return () => window.clearTimeout(timeout);
  }, [onComplete, spec]);

  return (
    <div
      className={cn("flex items-center justify-center gap-3 flex-wrap", className)}
      role="img"
      aria-label={`Rolled ${finals.join(", ")} on a d${spec.sides}`}
    >
      {finals.map((value, index) => (
        <AnimatedDie
          key={`final-${index}`}
          sides={spec.sides}
          value={value}
          spinDeg={params[index]!.spinDeg}
          delayMs={params[index]!.delayMs}
          accentColor={accentColor}
        />
      ))}
      {ignored.map((value, index) => (
        <AnimatedDie
          key={`ignored-${index}`}
          sides={spec.sides}
          value={value}
          spinDeg={params[finals.length + index]!.spinDeg}
          delayMs={params[finals.length + index]!.delayMs}
          accentColor={accentColor}
          muted
        />
      ))}
    </div>
  );
}

interface AnimatedDieProps {
  sides: number;
  value: number;
  spinDeg: number;
  delayMs: number;
  accentColor?: string;
  muted?: boolean;
}

function AnimatedDie({ sides, value, spinDeg, delayMs, accentColor, muted }: AnimatedDieProps) {
  return (
    <div
      className="animate-dice-roll"
      style={
        {
          animationDelay: `${delayMs}ms`,
          ["--dice-spin" as string]: `${spinDeg}deg`,
        } as React.CSSProperties
      }
    >
      <DieFaceStatic
        sides={sides}
        value={value}
        size="lg"
        accentColor={accentColor}
        muted={muted}
      />
    </div>
  );
}

function generateParams(): DieAnimationParams {
  const turns = 2 + Math.random();
  const sign = Math.random() < 0.5 ? -1 : 1;
  return {
    spinDeg: Math.round(turns * 360 * sign),
    delayMs: Math.floor(Math.random() * 120),
  };
}

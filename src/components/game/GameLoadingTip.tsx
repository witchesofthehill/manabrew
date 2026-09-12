import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useIsTouch } from "@/hooks/useBreakpoints";
import { formatCombo } from "@/lib/keybindings";
import { cn } from "@/lib/utils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { resolveCombo, useKeybindingsStore } from "@/stores/useKeybindingsStore";
import {
  GAME_LOADING_TIPS,
  GAME_LOADING_TIP_INTERVAL_MS,
  GAME_LOADING_TIP_TRANSITION_MS,
} from "./gameLoadingTips";

function nextTipIndex(current: number, count: number): number {
  if (count < 2) return 0;
  return (current + 1 + Math.floor(Math.random() * (count - 1))) % count;
}

export function GameLoadingTip() {
  const isTouch = useIsTouch();
  const keybindingOverrides = useKeybindingsStore((s) => s.overrides);
  const tips = useMemo(
    () =>
      GAME_LOADING_TIPS.filter(
        (tip) => tip.audience === "all" || tip.audience === (isTouch ? "touch" : "desktop"),
      ),
    [isTouch],
  );
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * tips.length));
  const [tipVisible, setTipVisible] = useState(true);
  const transitionTimer = useRef<number | undefined>(undefined);
  const tip = tips[tipIndex % tips.length]!;
  const shortcuts = (tip.keybindingIds ?? []).flatMap((id) => {
    const combo = resolveCombo(id, keybindingOverrides);
    return combo ? [{ id, label: formatCombo(combo) }] : [];
  });

  useEffect(() => {
    if (tips.length < 2) return;
    const interval = window.setInterval(() => {
      const advance = () => setTipIndex((current) => nextTipIndex(current, tips.length));
      if (!animationsEnabled()) {
        advance();
        return;
      }
      setTipVisible(false);
      window.clearTimeout(transitionTimer.current);
      transitionTimer.current = window.setTimeout(() => {
        advance();
        setTipVisible(true);
      }, GAME_LOADING_TIP_TRANSITION_MS);
    }, GAME_LOADING_TIP_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(transitionTimer.current);
    };
  }, [tips.length]);

  return (
    <div className="flex min-h-28 overflow-hidden border-t border-card-ring/30 bg-card/70 px-6 py-5 text-left sm:min-h-36 sm:px-7 sm:py-6">
      <div className="mr-4 mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-card-ring/40 bg-card-ring/10 text-card-ring">
        <Sparkles className="size-5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-xs font-semibold uppercase tracking-wide text-card-ring">Table tip</p>
        <div
          className={cn(
            "flex min-h-16 flex-1 items-center gap-3 transition-[opacity,transform] ease-out motion-reduce:transition-none",
            tipVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
          )}
          style={{ transitionDuration: `${GAME_LOADING_TIP_TRANSITION_MS}ms` }}
        >
          {shortcuts.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {shortcuts.map((shortcut) => (
                <kbd
                  key={shortcut.id}
                  className="rounded-md border border-card-ring/40 bg-card-ring/10 px-3 py-1.5 font-mono text-base font-bold text-foreground shadow-sm"
                >
                  {shortcut.label}
                </kbd>
              ))}
            </div>
          )}
          <p className="min-w-0 flex-1 text-base leading-relaxed text-foreground sm:text-lg">
            {tip.text}
          </p>
        </div>
      </div>
    </div>
  );
}

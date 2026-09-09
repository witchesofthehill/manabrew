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
    <div className="flex min-h-24 overflow-hidden border-t border-card-ring/30 bg-card/70 px-6 py-4 text-left">
      <div className="mr-3 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-card-ring/30 bg-card-ring/10 text-card-ring">
        <Sparkles className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-xs font-semibold uppercase tracking-wide text-card-ring">Table tip</p>
        <div
          className={cn(
            "flex min-h-12 flex-1 flex-col justify-center gap-2 transition-[opacity,transform] ease-out motion-reduce:transition-none",
            tipVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
          )}
          style={{ transitionDuration: `${GAME_LOADING_TIP_TRANSITION_MS}ms` }}
        >
          {shortcuts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {shortcuts.map((shortcut) => (
                <kbd
                  key={shortcut.id}
                  className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground shadow-sm"
                >
                  {shortcut.label}
                </kbd>
              ))}
            </div>
          )}
          <p className="text-sm leading-relaxed text-foreground">{tip.text}</p>
        </div>
      </div>
    </div>
  );
}

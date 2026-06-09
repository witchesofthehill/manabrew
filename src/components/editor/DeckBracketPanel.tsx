import { useState } from "react";
import { ChevronDown, ChevronRight, Gauge, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeckAnalysisStore } from "@/stores/useDeckAnalysisStore";
import { BRACKET_INFO, bracketAdvice, type Bracket } from "@/lib/brackets";

const BRACKET_STYLE: Record<Bracket, { badge: string; text: string }> = {
  1: { badge: "bg-muted text-muted-foreground", text: "text-muted-foreground" },
  2: { badge: "bg-primary/15 text-primary", text: "text-primary" },
  3: { badge: "bg-warning/15 text-warning", text: "text-warning" },
  4: { badge: "bg-pt-lethal/15 text-pt-lethal", text: "text-pt-lethal" },
  5: { badge: "bg-destructive/15 text-destructive", text: "text-destructive" },
};

export function DeckBracketPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const bracket = useDeckAnalysisStore((s) => s.bracket);
  const loading = useDeckAnalysisStore((s) => s.loading);

  if (!bracket && !loading) return null;

  const info = bracket ? BRACKET_INFO[bracket.bracket] : null;
  const style = bracket ? BRACKET_STYLE[bracket.bracket] : null;
  const advice = bracket ? bracketAdvice(bracket) : null;

  return (
    <div className="border-t shrink-0">
      <div
        role="button"
        tabIndex={0}
        className="flex items-center gap-1.5 w-full px-3 py-2 hover:bg-muted/30 transition-colors text-left cursor-pointer"
        onClick={() => setCollapsed((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed((v) => !v);
          }
        }}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Bracket
        </span>
        <div className="ml-auto flex items-center gap-2">
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {bracket && info && style && (
            <span
              className={cn(
                "text-xs font-semibold rounded px-1.5 py-0.5 tabular-nums",
                style.badge,
              )}
            >
              {bracket.bracket} · {info.name}
            </span>
          )}
        </div>
      </div>

      {!collapsed && bracket && info && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-xs text-muted-foreground">{info.blurb}</p>

          <ul className="space-y-0.5">
            {bracket.reasons.map((reason, i) => (
              <li key={i} className="text-xs text-muted-foreground/80 flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5">&#x2022;</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>

          {bracket.gameChangers.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-pt-lethal/70">
                Game Changers ({bracket.gameChangers.length})
              </span>
              <div className="flex flex-wrap gap-1">
                {bracket.gameChangers.map((name) => (
                  <span
                    key={name}
                    className="text-[10px] rounded bg-pt-lethal/10 text-pt-lethal px-1.5 py-0.5"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {advice && advice.actions.length > 0 && (
            <div className="space-y-1 rounded-md border border-border/40 bg-muted/20 p-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                To reach Bracket {advice.target}
              </span>
              <ul className="space-y-0.5">
                {advice.actions.map((action, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="shrink-0 mt-0.5">&#x2022;</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/50 italic">
            Estimate covers brackets 2–4. Bracket 1 (casual) and 5 (cEDH) are self-declared.
          </p>
        </div>
      )}
    </div>
  );
}

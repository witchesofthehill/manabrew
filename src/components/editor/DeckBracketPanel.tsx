import { Gauge, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeckAnalysisStore } from "@/stores/useDeckAnalysisStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { Button } from "@/components/ui/button";
import { BRACKET_INFO, bracketAdvice, type Bracket } from "@/lib/brackets";
import { EDITOR_PANEL_CLASS, EDITOR_SUBTLE_BLOCK_CLASS } from "./deckEditor.styles";
const BRACKET_STYLE: Record<
  Bracket,
  {
    badge: string;
    text: string;
  }
> = {
  1: { badge: "bg-muted text-muted-foreground", text: "text-muted-foreground" },
  2: { badge: "bg-primary/15 text-primary", text: "text-primary" },
  3: { badge: "bg-warning/15 text-warning", text: "text-warning" },
  4: { badge: "bg-pt-lethal/15 text-pt-lethal", text: "text-pt-lethal" },
  5: { badge: "bg-destructive/15 text-destructive", text: "text-destructive" },
};
export function DeckBracketPanel() {
  const bracket = useDeckAnalysisStore((s) => s.bracket);
  const loading = useDeckAnalysisStore((s) => s.loading);
  const error = useDeckAnalysisStore((s) => s.error);
  const analyze = useDeckAnalysisStore((s) => s.analyze);

  if (!bracket && !loading && !error) return null;

  const info = bracket ? BRACKET_INFO[bracket.bracket] : null;
  const style = bracket ? BRACKET_STYLE[bracket.bracket] : null;
  const advice = bracket ? bracketAdvice(bracket) : null;
  return (
    <section className={EDITOR_PANEL_CLASS}>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <Gauge className="h-4 w-4 text-muted-foreground shrink-0" />
        <h3 className="text-ui-label font-semibold">Bracket</h3>
        <div className="ml-auto flex items-center gap-2">
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {bracket && info && style && (
            <span
              className={cn(
                "text-ui-meta font-semibold rounded px-1.5 py-0.5 tabular-nums",
                style.badge,
              )}
            >
              {bracket.bracket} &middot; {info.name}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 space-y-1 text-ui-body text-muted-foreground">
          <p>{error}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => analyze(useDeckStore.getState().currentDeck)}
          >
            Retry analysis
          </Button>
        </div>
      )}

      {bracket && info && (
        <div className="space-y-3">
          <p className="text-ui-body text-muted-foreground">{info.blurb}</p>

          <ul className="space-y-1">
            {bracket.reasons.map((reason, i) => (
              <li
                key={i}
                className="text-ui-body text-muted-foreground/80 flex items-start gap-1.5"
              >
                <span className="shrink-0 mt-0.5">&#x2022;</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>

          {bracket.communityCombos.length > 0 && (
            <div className="space-y-1.5 text-ui-body text-muted-foreground">
              <p className="font-semibold">EDHREC community votes</p>
              {bracket.communityCombos.map(({ id, names, vote }) => (
                <a
                  key={id}
                  href={vote.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block hover:underline"
                >
                  {names}: Bracket {vote.bracket}+ · {vote.voteCount} votes
                  {vote.controversial ? " · Contested" : ""}
                </a>
              ))}
            </div>
          )}

          {bracket.gameChangers.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-ui-meta font-semibold uppercase tracking-wider text-pt-lethal/70">
                Game Changers ({bracket.gameChangers.length})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {bracket.gameChangers.map((name) => (
                  <span
                    key={name}
                    className="text-ui-label rounded bg-pt-lethal/10 text-pt-lethal px-1.5 py-0.5"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {advice && advice.actions.length > 0 && (
            <div className={cn("space-y-1.5", EDITOR_SUBTLE_BLOCK_CLASS)}>
              <span className="text-ui-label font-semibold uppercase tracking-wider text-muted-foreground/70">
                To reach Bracket {advice.target}
              </span>
              <ul className="space-y-1">
                {advice.actions.map((action, i) => (
                  <li
                    key={i}
                    className="text-ui-body text-muted-foreground flex items-start gap-1.5"
                  >
                    <span className="shrink-0 mt-0.5">&#x2022;</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-ui-body text-muted-foreground/50 italic">
            Estimate covers brackets 2–4. Bracket 1 (casual) and 5 (cEDH) are self-declared.{" "}
            Community votes are guidance, not official bracket rulings.
          </p>
        </div>
      )}
    </section>
  );
}

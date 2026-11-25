import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { BRACKET_INFO, type Bracket } from "@/lib/brackets";
import { cn } from "@/lib/utils";
import { tableLabel, useMatchmakingStore } from "@/stores/useMatchmakingStore";
import { useServerStore } from "@/stores/useServerStore";
import { RELAY_FEATURE } from "@/types/server";

const BRACKETS = [1, 2, 3, 4, 5];

function toggledSteps(steps: number[], bracket: number): number[] {
  return steps.includes(bracket)
    ? steps.filter((step) => step !== bracket)
    : [...steps, bracket].sort((a, b) => a - b);
}

export function MatchmakingSearchDetails({
  run,
  pending,
}: {
  run: (action: () => Promise<void>) => void;
  pending: boolean;
}) {
  const { podSizes, brackets, queuedDecks, waiting, botFillOffer, botFill } = useMatchmakingStore();
  const canExclude = useServerStore((state) =>
    state.relayFeatures.includes(RELAY_FEATURE.QueueSteps),
  );
  const deckBrackets = [...new Set(queuedDecks.map((deck) => deck.bracket))].sort((a, b) => a - b);
  const steps = brackets.filter((bracket) => !deckBrackets.includes(bracket));
  const extras = BRACKETS.filter((bracket) => !deckBrackets.includes(bracket));
  const searching = (bracket: number) =>
    waiting.find((entry) => entry.bracket === bracket)?.players ?? 0;

  return (
    <div className="space-y-4">
      <p className="text-ui-meta text-muted-foreground">{podSizes.map(tableLabel).join(" or ")}</p>
      <BracketGroup title="Your decks">
        {deckBrackets.map((bracket) => (
          <BracketRow
            key={bracket}
            bracket={bracket}
            included
            players={searching(bracket)}
            decks={queuedDecks
              .filter((deck) => deck.bracket === bracket)
              .map((deck) => deck.deck_name)}
          />
        ))}
      </BracketGroup>
      {extras.length > 0 && (
        <BracketGroup title="Also accept matches with:">
          {extras.map((bracket) => {
            const included = steps.includes(bracket);
            return (
              <BracketRow
                key={bracket}
                bracket={bracket}
                included={included}
                players={searching(bracket)}
                disabled={pending || (included && !canExclude)}
                onToggle={() =>
                  run(() => useMatchmakingStore.getState().setSteps(toggledSteps(steps, bracket)))
                }
              />
            );
          })}
        </BracketGroup>
      )}
      {botFill && (
        <p className="text-ui-meta text-muted-foreground">
          Manabot fills empty seats when another player who allows it is ready.
        </p>
      )}
      {botFillOffer !== null && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-ui-label">
            {botFillOffer === 1 ? "Another player is" : `${botFillOffer} players are`} ready at your
            bracket. Let Manabot fill the remaining seats?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => useMatchmakingStore.getState().acceptBotFill())}
            >
              Allow Manabot
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => useMatchmakingStore.getState().dismissBotFill()}
            >
              Wait for players
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BracketGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-ui-meta font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function BracketRow({
  bracket,
  included,
  players,
  decks = [],
  disabled = false,
  onToggle,
}: {
  bracket: number;
  included: boolean;
  players: number;
  decks?: string[];
  disabled?: boolean;
  onToggle?: () => void;
}) {
  const name = BRACKET_INFO[bracket as Bracket].name;
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-ui-label font-medium">
          {included ? `Bracket ${bracket}` : `Include bracket ${bracket}`} · {name}
        </span>
        {decks.length > 0 && (
          <span className="block truncate text-ui-meta text-muted-foreground">
            {decks.join(", ")}
          </span>
        )}
      </span>
      {players > 0 && (
        <span className="shrink-0 text-ui-meta text-muted-foreground tabular-nums">
          {players} searching
        </span>
      )}
      {included && <Check className="h-4 w-4 shrink-0 text-selection-foreground" />}
    </>
  );
  const rowClass =
    "flex min-h-10 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left touch:min-h-11";
  if (!onToggle) {
    return <div className={cn(rowClass, "border-border bg-card")}>{content}</div>;
  }
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={included}
      onClick={onToggle}
      className={cn(
        rowClass,
        "transition-colors disabled:opacity-60",
        included
          ? "border-selection-border bg-selection hover:ring-1 hover:ring-selection-border"
          : "border-border hover:bg-muted",
      )}
    >
      {content}
    </button>
  );
}

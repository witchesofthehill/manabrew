import { Button } from "@/components/ui/button";
import { tableLabel, useMatchmakingStore } from "@/stores/useMatchmakingStore";

export function MatchmakingSearchDetails({
  run,
  pending,
}: {
  run: (action: () => Promise<void>) => void;
  pending: boolean;
}) {
  const { podSizes, brackets, deckNames, waiting, offer, botFillOffer, botFill } =
    useMatchmakingStore();

  return (
    <div className="flex max-h-[35dvh] flex-col gap-3 overflow-y-auto border-t border-border py-3">
      <div className="space-y-1 text-ui-meta text-muted-foreground">
        <p>
          {podSizes.map(tableLabel).join(" or ")} · Bracket {brackets.join(" / ")}
        </p>
        <p className="break-words">{deckNames.join(" · ")}</p>
        <p>Keep browsing or play against Manabot. We’ll let you know when a table is ready.</p>
        {waiting.length > 0 && (
          <p>
            Players searching:{" "}
            {waiting.map(({ bracket, players }) => `B${bracket}: ${players}`).join(" · ")}
          </p>
        )}
        {botFill && <p>Manabot can fill empty seats when the other players agree.</p>}
      </div>
      {offer && (
        <div className="space-y-2">
          <p className="text-ui-body">Find more players by including a nearby bracket.</p>
          <div className="flex flex-wrap gap-2">
            {[offer.down, offer.up].map((bracket) =>
              bracket === null ? null : (
                <Button
                  key={bracket}
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => useMatchmakingStore.getState().acceptStep(bracket))}
                >
                  Include bracket {bracket}
                </Button>
              ),
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => useMatchmakingStore.getState().dismissOffer()}
            >
              Keep my brackets
            </Button>
          </div>
        </div>
      )}
      {botFillOffer !== null && (
        <div className="space-y-2">
          <p className="text-ui-body">
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

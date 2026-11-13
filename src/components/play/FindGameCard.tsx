import { Loader2, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { commanderQueueDecks } from "@/lib/queueDecks";
import { cn } from "@/lib/utils";
import {
  POD_SIZES,
  podSizesFor,
  tableLabel,
  useMatchmakingStore,
  type PodSize,
} from "@/stores/useMatchmakingStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";
import { RELAY_FEATURE, type QueueBracketCount } from "@/types/server";

function waitingAt(waiting: QueueBracketCount[], bracket: number): number {
  return waiting.find((entry) => entry.bracket === bracket)?.players ?? 0;
}

function playersLabel(count: number): string {
  return count === 1 ? "1 player waiting" : `${count} players waiting`;
}

export function FindGameCard() {
  const ownedDecks = useOwnedDecks();
  const connected = useServerStore((state) => state.connected);
  const supported = useServerStore((state) => state.relayFeatures).includes(
    RELAY_FEATURE.Matchmaking,
  );
  const {
    phase,
    auto,
    podSizes,
    queuedAt,
    brackets,
    waiting,
    offer,
    botFillOffer,
    botFill,
    proposal,
  } = useMatchmakingStore();
  const openToHumans = usePreferencesStore((state) => state.openToHumanMatches);
  const [eitherSize, setEitherSize] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (phase !== "queued") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  if (!connected || !supported) return null;

  async function find(size: PodSize) {
    setPreparing(true);
    try {
      const decks = await commanderQueueDecks(ownedDecks.map(({ deck }) => deck));
      if (decks.length === 0) {
        toast.error("Save a Commander deck with a commander to find a game.");
        return;
      }
      await useMatchmakingStore.getState().enter(podSizesFor(size, eitherSize), decks);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not join the queue.");
    } finally {
      setPreparing(false);
    }
  }

  function setOpenToHumans(open: boolean) {
    usePreferencesStore.getState().setOpenToHumanMatches(open);
    if (!open && auto) void useMatchmakingStore.getState().leave();
  }

  const elapsed = queuedAt ? Math.max(0, Math.floor((now - queuedAt) / 1000)) : 0;
  const queued = phase === "queued" || phase === "proposed";
  const tables = podSizes.map(tableLabel).join(" or ");

  return (
    <section
      aria-label="Find a game"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-md sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary">
          <Users className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-ui-label font-medium text-foreground">Find a Commander game</h2>
          <p className="mt-0.5 text-ui-body leading-snug text-muted-foreground">
            {phase === "proposed" && proposal
              ? proposal.busy > 0
                ? `Match found at bracket ${proposal.bracket}. Waiting for ${proposal.busy === 1 ? "1 player" : `${proposal.busy} players`} to finish a game.`
                : `Match found at bracket ${proposal.bracket}. Waiting for every player to accept.`
              : queued
                ? `Looking for a ${tables} · ${elapsed}s · your brackets ${brackets.join(", ")}`
                : "Queue all your Commander decks. You play the first one that finds a full table."}
          </p>
        </div>
        {queued && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void useMatchmakingStore.getState().leave()}
          >
            <X /> Cancel
          </Button>
        )}
      </div>

      {queued && (
        <p className="text-ui-meta text-muted-foreground">
          {auto
            ? "Queued from your game against Manabot with all your Commander decks. When a table is found you get 30 seconds to join."
            : "You can play against Manabot while you wait. When a table is found you get 30 seconds to join."}
        </p>
      )}

      <label className="flex items-center gap-2 text-ui-meta text-muted-foreground">
        <Checkbox
          checked={openToHumans === true}
          onCheckedChange={(checked) => setOpenToHumans(checked === true)}
        />
        Look for human players while I play Commander against Manabot
      </label>

      {!queued && (
        <label className="flex items-center gap-2 text-ui-meta text-muted-foreground">
          <Checkbox
            checked={eitherSize}
            onCheckedChange={(checked) => setEitherSize(checked === true)}
          />
          Also accept the other pod size (3 or 4 players)
        </label>
      )}

      {!queued && (
        <div className="flex flex-wrap gap-2">
          {POD_SIZES.map((size) => (
            <Button
              key={size}
              size="sm"
              variant={size === 4 ? "primary" : "outline"}
              disabled={preparing}
              onClick={() => void find(size)}
            >
              {preparing && <Loader2 className="animate-spin" />}
              {tableLabel(size)}
            </Button>
          ))}
        </div>
      )}

      {queued && waiting.length > 0 && (
        <p className="text-ui-meta text-muted-foreground">
          Also queued:{" "}
          {waiting.map((entry) => `bracket ${entry.bracket} (${entry.players})`).join(", ")}
        </p>
      )}

      {queued && botFill && (
        <p className="text-ui-meta text-muted-foreground">
          Starting with Manabot in empty seats once another player agrees.
        </p>
      )}

      {queued && botFillOffer !== null && (
        <div className="flex flex-col gap-2 rounded-lg border border-secondary/60 bg-secondary/10 p-3">
          <p className="text-ui-body text-foreground">
            {botFillOffer === 1 ? "1 player shares" : `${botFillOffer} players share`} your bracket,
            but the table is not full. Start now with Manabot in the empty seats?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void useMatchmakingStore.getState().acceptBotFill()}
            >
              Fill with Manabot
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => useMatchmakingStore.getState().dismissBotFill()}
            >
              Wait for players
            </Button>
          </div>
        </div>
      )}

      {queued && offer && (
        <div className="flex flex-col gap-2 rounded-lg border border-secondary/60 bg-secondary/10 p-3">
          <p className="text-ui-body text-foreground">
            Your table is not full yet. Also accept players one bracket away?
          </p>
          <div className="flex flex-wrap gap-2">
            {[offer.down, offer.up].map((bracket, index) =>
              bracket === null ? null : (
                <Button
                  key={bracket}
                  size="sm"
                  variant="secondary"
                  onClick={() => void useMatchmakingStore.getState().acceptStep(bracket)}
                >
                  {index === 0 ? "Step down" : "Step up"} to bracket {bracket}
                  <span className={cn("text-ui-meta text-muted-foreground")}>
                    {playersLabel(waitingAt(waiting, bracket))}
                  </span>
                </Button>
              ),
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => useMatchmakingStore.getState().dismissOffer()}
            >
              Keep waiting
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

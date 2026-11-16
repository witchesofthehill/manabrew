import { Search, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { ROUTES } from "@/lib/constants";
import {
  POD_SIZES,
  podSizesFor,
  tableLabel,
  useMatchmakingStore,
  type PodSize,
} from "@/stores/useMatchmakingStore";
import { useServerStore } from "@/stores/useServerStore";
import { RELAY_FEATURE } from "@/types/server";

export function FindGameCard({ disabled = false }: { disabled?: boolean }) {
  const ownedDecks = useOwnedDecks();
  const connected = useServerStore((state) => state.connected);
  const supported = useServerStore((state) => state.relayFeatures).includes(
    RELAY_FEATURE.Matchmaking,
  );
  const phase = useMatchmakingStore((state) => state.phase);
  const [size, setSize] = useState<PodSize>(4);
  const [eitherSize, setEitherSize] = useState(true);
  const [excluded, setExcluded] = useState<string[]>([]);
  const decks = ownedDecks.filter(
    ({ deck }) => deck.format === "commander" && (deck.commanders?.length ?? 0) > 0,
  );
  const selected = decks.filter(({ id }) => !excluded.includes(id));

  if (!connected || !supported || phase !== "idle") return null;

  async function find() {
    try {
      await useMatchmakingStore.getState().enter(
        podSizesFor(size, eitherSize),
        selected.map(({ deck }) => deck),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the search.");
    }
  }

  return (
    <section
      aria-label="Find a game"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-md sm:p-5"
    >
      <div className="flex items-start gap-3">
        <Users className="mt-1 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 className="font-serif text-2xl font-semibold">Find a Commander game</h2>
          <p className="mt-1 text-ui-body text-muted-foreground">
            We’ll find players at your decks’ brackets. Keep browsing or play against Manabot while
            you wait.
          </p>
        </div>
      </div>
      {decks.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-ui-body text-muted-foreground">
            Save a Commander deck with a commander to get started.
          </p>
          <Button variant="primary" asChild>
            <Link to={ROUTES.DECK_EDITOR}>Choose a deck</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {POD_SIZES.map((podSize) => (
                <Button
                  key={podSize}
                  size="sm"
                  variant={size === podSize ? "selected" : "outline"}
                  disabled={disabled}
                  onClick={() => setSize(podSize)}
                >
                  {tableLabel(podSize)}
                </Button>
              ))}
            </div>
            {size !== 2 && (
              <label className="flex min-h-8 cursor-pointer items-center gap-2 text-ui-meta text-muted-foreground touch:min-h-11">
                <Checkbox
                  checked={eitherSize}
                  disabled={disabled}
                  onCheckedChange={(checked) => setEitherSize(checked === true)}
                />
                {size === 4 ? "3 players is fine too" : "4 players is fine too"}
              </label>
            )}
          </div>
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-ui-label touch:min-h-11">
              {selected.length === decks.length
                ? `All ${decks.length === 1 ? "1 Commander deck" : `${decks.length} Commander decks`}`
                : `${selected.length} of ${decks.length} decks selected`}
              <span className="ml-2 text-ui-meta text-muted-foreground">Change decks</span>
            </summary>
            <div className="max-h-48 space-y-1 overflow-y-auto border-t border-border p-2">
              {decks.map(({ id, deck }) => (
                <label
                  key={id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
                >
                  <Checkbox
                    checked={!excluded.includes(id)}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      setExcluded((ids) =>
                        checked === true ? ids.filter((value) => value !== id) : [...ids, id],
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-ui-label">{deck.name}</span>
                    <span className="block truncate text-ui-meta text-muted-foreground">
                      {deck.commanders?.map((card) => card.identity.name).join(" & ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ui-meta text-muted-foreground">
              {selected.length === 0
                ? "Select at least one deck to find a game."
                : selected.length > 32
                  ? "Choose up to 32 decks for your search."
                  : "If several decks fit the table, you can choose before joining."}
            </p>
            <Button
              variant="primary"
              disabled={disabled || selected.length === 0 || selected.length > 32}
              className="w-full sm:w-auto"
              onClick={() => void find()}
            >
              <Search /> Find game
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

import { Check, Loader2, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import brewy from "@/assets/brewy-combat.webp";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { DeckSelectionCard } from "@/components/lobby/DeckSelectionCard";
import { useDeckBrackets } from "@/components/lobby/useDeckBrackets";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { BRACKET_INFO, type Bracket } from "@/lib/brackets";
import { cn } from "@/lib/utils";
import type { Deck } from "@/protocol/deck";
import { POD_SIZES, useMatchmakingStore, type PodSize } from "@/stores/useMatchmakingStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { useServerStore } from "@/stores/useServerStore";
import { RELAY_FEATURE } from "@/types/server";

const MAX_QUEUED_DECKS = 32;
const DECK_GRID = "grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))]";
const POD_DESCRIPTIONS: Record<PodSize, string> = {
  4: "Classic Commander",
  3: "Faster multiplayer",
  2: "Head to head",
};

interface DeckOption {
  id: string;
  deck: Deck;
  isPreset: boolean;
}

function isCommanderDeck(deck: Deck): boolean {
  return deck.format === "commander" && (deck.commanders?.length ?? 0) > 0;
}

export function FindGameDialog({
  open,
  onOpenChange,
  disabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}) {
  const ownedDecks = useOwnedDecks();
  const presetDecks = usePresetDecks("Forge");
  const connected = useServerStore((state) => state.connected);
  const supported = useServerStore((state) => state.relayFeatures).includes(
    RELAY_FEATURE.Matchmaking,
  );
  const phase = useMatchmakingStore((state) => state.phase);
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const [sizes, setSizes] = useState<PodSize[]>([4, 3]);
  const [botFill, setBotFill] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [starters, setStarters] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const owned: DeckOption[] = ownedDecks
    .filter(({ deck }) => isCommanderDeck(deck))
    .map(({ id, deck }) => ({ id, deck, isPreset: false }));
  const presets: DeckOption[] = presetDecks
    .filter(isCommanderDeck)
    .map((deck) => ({ id: `preset__${deck.id ?? deck.name}`, deck, isPreset: true }));
  const selected = [
    ...owned.filter(({ id }) => !excluded.includes(id)),
    ...presets.filter(({ id }) => starters.includes(id)),
  ];
  const selectedIds = selected.map(({ id }) => id);
  const query = search.trim().toLowerCase();
  const matches = ({ deck }: DeckOption) =>
    !query ||
    deck.name.toLowerCase().includes(query) ||
    (deck.commanders ?? []).some((card) => card.identity.name.toLowerCase().includes(query));
  const allOwnedSelected = owned.every(({ id }) => !excluded.includes(id));
  const tooMany = selected.length > MAX_QUEUED_DECKS;
  const podSizes = POD_SIZES.filter((podSize) => sizes.includes(podSize));
  const canBotFill = podSizes.some((podSize) => podSize > 2);
  const brackets = useDeckBrackets(
    [...owned, ...presets],
    open && connected && supported && phase === "idle",
  );
  const checkingBrackets = selected.some(({ id }) => brackets[id] === undefined);
  const bracketGroups = [...new Set(selected.flatMap(({ id }) => brackets[id] ?? []))]
    .sort((a, b) => a - b)
    .map((bracket) => ({
      bracket,
      names: selected.filter(({ id }) => brackets[id] === bracket).map(({ deck }) => deck.name),
    }));

  if (!connected || !supported || phase !== "idle") return null;

  function toggle({ id, isPreset }: DeckOption) {
    const update = (ids: string[]) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
    if (isPreset) setStarters(update);
    else setExcluded(update);
  }

  async function find() {
    try {
      onOpenChange(false);
      await useMatchmakingStore.getState().enter(
        podSizes,
        selected.map(({ deck }) => deck),
        botFill && canBotFill,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the search.");
    }
  }

  function deckGrid(options: DeckOption[]) {
    const groups = new Map<number | undefined, DeckOption[]>();
    for (const option of options) {
      const bracket = brackets[option.id];
      groups.set(bracket, [...(groups.get(bracket) ?? []), option]);
    }
    const ordered = [...groups].sort(
      ([a], [b]) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY),
    );
    return (
      <div className="space-y-5">
        {ordered.map(([bracket, items]) => (
          <div key={bracket ?? "checking"} className="space-y-2">
            <BracketHeader bracket={bracket} />
            <div className={DECK_GRID}>
              {items.map((option) => (
                <DeckSelectionCard
                  key={option.id}
                  name={option.deck.name}
                  desc={option.isPreset ? option.deck.description : undefined}
                  color={option.isPreset ? option.deck.color : undefined}
                  labels={option.deck.labels}
                  cards={[...option.deck.cards, ...(option.deck.commanders ?? [])]}
                  cover={resolveCoverCard(option.deck)}
                  isPreset={option.isPreset}
                  isSelected={selectedIds.includes(option.id)}
                  dense
                  isTouch={isTouch}
                  disabled={disabled}
                  onSelect={() => toggle(option)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const visibleOwned = owned.filter(matches);
  const visiblePresets = presets.filter(matches);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[min(52rem,calc(var(--visual-viewport-height,100dvh)-2rem-var(--safe-area-inset-top)-var(--safe-area-inset-bottom)))] p-0 gap-0 overflow-hidden grid-rows-[minmax(0,1fr)_auto] [&>button]:top-7 [&>button]:right-6 touch:[&>button]:top-6">
        <div className="flex min-h-0 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
          <div className="flex w-full shrink-0 flex-col border-b bg-card px-8 pt-8 pb-6 sm:w-[22rem] sm:overflow-y-auto sm:border-r sm:border-b-0">
            <DialogTitle className="font-serif text-4xl font-semibold leading-tight">
              Find a Commander game
            </DialogTitle>
            <DialogDescription className="mt-3">
              You’ll be matched with the same bracket of your deck.
            </DialogDescription>
            <div className="mt-8">
              <SectionLabel>Table size</SectionLabel>
            </div>
            <div className="mt-3 space-y-2">
              {POD_SIZES.map((podSize) => (
                <button
                  key={podSize}
                  type="button"
                  aria-pressed={sizes.includes(podSize)}
                  disabled={disabled}
                  onClick={() =>
                    setSizes((current) =>
                      current.includes(podSize)
                        ? current.filter((value) => value !== podSize)
                        : [...current, podSize],
                    )
                  }
                  className={cn(
                    "flex min-h-10 w-full items-center gap-3 rounded-lg border px-3 text-left transition-colors touch:min-h-11 disabled:opacity-60",
                    sizes.includes(podSize)
                      ? "border-selection-border bg-selection"
                      : "border-border hover:bg-muted",
                  )}
                >
                  <span className="text-ui-label font-medium">
                    {podSize === 2 ? "1v1" : `${podSize} players`}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ui-meta text-muted-foreground">
                    {POD_DESCRIPTIONS[podSize]}
                  </span>
                  {sizes.includes(podSize) && (
                    <Check className="h-4 w-4 shrink-0 text-selection-foreground" />
                  )}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-start gap-3 px-1">
              <Checkbox
                id="find-game-bot-fill"
                checked={botFill && canBotFill}
                disabled={disabled || !canBotFill}
                onCheckedChange={(checked) => setBotFill(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor="find-game-bot-fill" className="space-y-1 font-normal">
                <span className="block text-ui-label font-medium">
                  Fill empty seats with Manabot
                </span>
                <span className="block text-ui-meta text-muted-foreground">
                  Start with another player who allows it. After a minute alone, start with Manabot
                  in every other seat.
                </span>
              </Label>
            </div>
            {!shortScreen && (
              <img
                src={brewy}
                alt=""
                className="pointer-events-none mx-auto mt-auto hidden h-60 shrink-0 translate-x-[9%] select-none sm:block"
              />
            )}
          </div>

          <div className="flex min-h-64 flex-1 flex-col sm:min-h-0">
            <div className="pt-6 pr-20 pb-4 pl-6">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  aria-label="Filter decks"
                  placeholder="Filter decks or commanders..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full rounded-md border bg-background py-2 pr-3 pl-8 text-ui-input focus:ring-1 focus:ring-primary focus:outline-none touch:min-h-11"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-8 px-6 pb-8 sm:overflow-y-auto">
              <DeckSection
                title="Your Commander decks"
                action={
                  owned.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => setExcluded(allOwnedSelected ? owned.map(({ id }) => id) : [])}
                    >
                      {allOwnedSelected ? "Clear" : "Select all"}
                    </Button>
                  )
                }
              >
                {owned.length === 0 ? (
                  <p className="text-ui-meta text-muted-foreground italic">
                    You have no Commander decks with a commander yet. Bring a starter deck instead.
                  </p>
                ) : visibleOwned.length === 0 ? (
                  <p className="text-ui-meta text-muted-foreground italic">
                    No decks match your search.
                  </p>
                ) : (
                  deckGrid(visibleOwned)
                )}
              </DeckSection>

              {presets.length > 0 && (
                <DeckSection title="Starter decks">
                  {visiblePresets.length === 0 ? (
                    <p className="text-ui-meta text-muted-foreground italic">
                      No starter decks match your search.
                    </p>
                  ) : (
                    deckGrid(visiblePresets)
                  )}
                </DeckSection>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-4 border-t px-8 py-5 sm:flex-row sm:items-center sm:justify-between">
          {podSizes.length === 0 || selected.length === 0 || tooMany ? (
            <p className={cn("text-ui-label", tooMany ? "text-warning" : "text-muted-foreground")}>
              {podSizes.length === 0
                ? "Select at least one table size."
                : selected.length === 0
                  ? "Select at least one deck."
                  : `Choose up to ${MAX_QUEUED_DECKS} decks.`}
            </p>
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
              {bracketGroups.map(({ bracket, names }) => (
                <p key={bracket} className="min-w-0 text-ui-label">
                  <span className="font-semibold">
                    Bracket {bracket} · {BRACKET_INFO[bracket as Bracket].name}
                  </span>
                  <span className="ml-2 text-muted-foreground">{names.join(" or ")}</span>
                </p>
              ))}
              {checkingBrackets && (
                <p className="flex items-center gap-2 text-ui-label text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking brackets…
                </p>
              )}
            </div>
          )}
          <div className="flex shrink-0 justify-end">
            <Button
              variant="primary"
              disabled={disabled || podSizes.length === 0 || selected.length === 0 || tooMany}
              onClick={() => void find()}
            >
              <Search /> Find game
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BracketHeader({ bracket }: { bracket: number | undefined }) {
  if (bracket === undefined) {
    return (
      <p className="flex items-center gap-2 text-ui-label text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking bracket…
      </p>
    );
  }
  const info = BRACKET_INFO[bracket as Bracket];
  return (
    <p className="flex min-w-0 items-baseline gap-2 text-ui-label">
      <span className="shrink-0 font-semibold">
        Bracket {bracket}
        {info && ` · ${info.name}`}
      </span>
      {info && <span className="truncate text-ui-meta text-muted-foreground">{info.blurb}</span>}
    </p>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Label className="text-ui-label font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </Label>
  );
}

function DeckSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <SectionLabel>{title}</SectionLabel>
        {action}
      </div>
      {children}
    </section>
  );
}

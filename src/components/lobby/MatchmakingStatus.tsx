import { Check, ChevronDown, Loader2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MatchmakingSearchDetails } from "@/components/lobby/MatchmakingSearchDetails";
import { ROUTES } from "@/lib/constants";
import { localGameActive } from "@/lib/localGamePresence";
import { queueDeckChoices } from "@/lib/queueDecks";
import { stripUsernameTag } from "@/lib/username";
import { cn } from "@/lib/utils";
import { useGameStore } from "@/stores/useGameStore";
import { tableLabel, useMatchmakingStore } from "@/stores/useMatchmakingStore";
import type { MatchProposalPayload, TableCallPayload } from "@/types/server";

async function joinMatch(
  invitation: MatchProposalPayload | TableCallPayload | null,
  deckIndex: number | undefined,
) {
  const { proposal, tableCall, proposalExpiresAt, tableCallExpiresAt } =
    useMatchmakingStore.getState();
  if (!invitation || invitation !== (proposal ?? tableCall)) return;
  const expiresAt = proposal ? proposalExpiresAt : tableCallExpiresAt;
  if (!expiresAt || Date.now() >= expiresAt) return;
  if (localGameActive()) await useGameStore.getState().endGame();
  const current = useMatchmakingStore.getState();
  if (proposal && current.proposal === proposal) await current.acceptMatch(deckIndex);
  else if (tableCall && current.tableCall === tableCall)
    await current.answerTableCall(true, deckIndex);
}

export function MatchmakingStatus() {
  const state = useMatchmakingStore();
  const gameActive = useGameStore((s) => s.isGameActive);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [selection, setSelection] = useState<{ offer: object; index: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { phase, proposal, tableCall, accepted, queuedAt, proposalExpiresAt, tableCallExpiresAt } =
    state;
  const active = phase !== "idle" && phase !== "matched";

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  const invitation = proposal ?? tableCall;
  const expiresAt = proposal ? proposalExpiresAt : tableCallExpiresAt;
  const remaining = expiresAt
    ? Math.min(invitation?.expires_s ?? 0, Math.max(0, Math.ceil((expiresAt - now) / 1000)))
    : 0;
  const elapsed = queuedAt ? Math.max(0, Math.floor((now - queuedAt) / 1000)) : 0;
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const choices = invitation ? queueDeckChoices(state.queuedDecks, invitation.bracket) : [];
  const deckIndex = selection?.offer === invitation ? selection.index : choices[0]?.index;
  const choosing = !!invitation && !accepted && phase !== "joining";
  const inSolo = gameActive && localGameActive();
  const hasOptions = !!state.offer || state.botFillOffer !== null;
  const title =
    phase === "preparing"
      ? "Checking your decks’ brackets…"
      : phase === "joining"
        ? "Joining your table…"
        : proposal
          ? accepted
            ? "Your seat is ready"
            : "Your Commander table is ready"
          : tableCall
            ? `${stripUsernameTag(tableCall.host)} has a seat for you`
            : "Finding a Commander game";

  function run(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    void action()
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : "Could not update your search. Try again.",
        ),
      )
      .finally(() => setPending(false));
  }

  return (
    <section className="shrink-0 border-b border-border bg-card text-foreground pl-[var(--safe-area-inset-left)] pr-[var(--safe-area-inset-right)]">
      <div className="mx-auto w-full max-w-5xl px-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
          {invitation ? (
            <Users className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none text-primary" />
          )}
          <div className="min-w-0 flex-1 basis-40">
            <p className="text-ui-label font-medium">{title}</p>
            <p className="text-ui-meta text-muted-foreground">
              {invitation
                ? `${tableLabel(invitation.pod_size)} · Bracket ${invitation.bracket}${accepted ? " · Waiting for the other players" : inSolo ? " · Joining ends your solo game" : ""}`
                : phase === "preparing"
                  ? "You can keep browsing."
                  : "Keep playing or browsing while we find your table."}
            </p>
          </div>
          <span className="text-ui-meta tabular-nums text-muted-foreground">
            {choosing ? `${remaining}s to join` : phase === "queued" ? elapsedLabel : ""}
          </span>
          {choosing ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={pending || remaining === 0 || deckIndex === undefined}
                onClick={() => run(() => joinMatch(invitation, deckIndex))}
              >
                {pending && <Loader2 className="animate-spin" />}
                {inSolo ? "Join now" : "Play now"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() => (proposal ? state.declineMatch() : state.answerTableCall(false)))
                }
              >
                {proposal ? "Leave search" : "Keep searching"}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {phase === "queued" && (
                <Button
                  variant={hasOptions ? "outline" : "ghost"}
                  size="sm"
                  onClick={() => setExpanded(!expanded)}
                >
                  {hasOptions ? "More ways to play" : "Search details"}
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
                  />
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(state.leave)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
        {choosing && choices.length > 1 && (
          <div className="space-y-2 border-t border-border py-3">
            <p className="text-ui-meta text-muted-foreground">Choose your deck for this table</p>
            <div className="flex max-h-[25dvh] flex-wrap gap-2 overflow-y-auto">
              {choices.map(({ deck, index }) => (
                <Button
                  key={index}
                  variant={deckIndex === index ? "selected" : "outline"}
                  disabled={pending || remaining === 0}
                  className="h-auto min-w-0 max-w-full justify-start whitespace-normal text-left"
                  onClick={() => setSelection({ offer: invitation, index })}
                >
                  {deckIndex === index && <Check className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0 break-words">
                    <span className="block">{deck.deck_name}</span>
                    <span className="block text-ui-meta">{deck.commander_name}</span>
                  </span>
                </Button>
              ))}
            </div>
          </div>
        )}
        {phase === "queued" && !tableCall && expanded && (
          <>
            <MatchmakingSearchDetails run={run} pending={pending} />
            {!gameActive && (
              <div className="pb-3">
                <Button variant="outline" size="sm" asChild>
                  <Link to={ROUTES.PLAY_OFFLINE_CONSTRUCTED}>
                    Play against Manabot while waiting
                  </Link>
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

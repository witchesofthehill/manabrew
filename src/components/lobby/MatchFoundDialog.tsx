import { Bot, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import brewy from "@/assets/brewy-combat.webp";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { DeckSelectionCard } from "@/components/lobby/DeckSelectionCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useIsTouch } from "@/hooks/useBreakpoints";
import { queueDeckChoices } from "@/lib/queueDecks";
import { stripUsernameTag } from "@/lib/username";
import { cn } from "@/lib/utils";
import { useMatchmakingStore } from "@/stores/useMatchmakingStore";
import type { MatchProposalPayload, TableCallPayload } from "@/types/server";

const RING_RADIUS = 46;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

interface MatchFoundDialogProps {
  invitation: MatchProposalPayload | TableCallPayload;
  expiresAt: number;
  now: number;
  inSolo: boolean;
  pending: boolean;
  onAccept: (deckIndex: number) => void;
  onDecline: () => void;
}

export function MatchFoundDialog({
  invitation,
  expiresAt,
  now,
  inSolo,
  pending,
  onAccept,
  onDecline,
}: MatchFoundDialogProps) {
  const { phase, accepted, proposal, proposalAccepts, tableCall, queuedDecks } =
    useMatchmakingStore();
  const isTouch = useIsTouch();
  const [selection, setSelection] = useState<{ offer: object; index: number } | null>(null);
  const left = Math.max(0, Math.min(invitation.expires_s, (expiresAt - now) / 1000));
  const remaining = Math.ceil(left);
  const progress = left / invitation.expires_s;
  const choices = queueDeckChoices(queuedDecks, invitation.bracket);
  const deckIndex = selection?.offer === invitation ? selection.index : choices[0]?.index;
  const waiting = accepted || phase === "joining";
  const acceptedSeats = Math.max(proposalAccepts, accepted ? 1 : 0);

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="max-w-3xl justify-items-center gap-0 px-8 py-10 text-center sm:px-12 [&>button]:hidden"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <div className="flex items-center gap-3 text-ui-label font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          <span aria-hidden className="h-px w-10 bg-border" />
          {tableCall ? `${stripUsernameTag(tableCall.host)} has a seat for you` : "Match found"}
          <span aria-hidden className="h-px w-10 bg-border" />
        </div>
        <DialogTitle className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">
          Prepare for battle!
        </DialogTitle>
        <DialogDescription className="mt-2 text-ui-body">
          Bracket {invitation.bracket}
        </DialogDescription>

        <div className="relative mt-5 h-52 w-52 shrink-0">
          <CountdownRing progress={progress} className="absolute inset-0 h-full w-full" />
          <img
            src={brewy}
            alt=""
            className="pointer-events-none absolute inset-x-0 top-[12%] mx-auto h-[62%] translate-x-[9%] select-none"
          />
          <span className="absolute inset-x-0 bottom-[11%] font-serif text-2xl font-semibold tabular-nums">
            {remaining}
          </span>
        </div>

        {proposal && (
          <div
            className="mt-5 flex items-center gap-2"
            aria-label={`${acceptedSeats} of ${proposal.players} players accepted`}
          >
            {Array.from({ length: proposal.pod_size }, (_, seat) =>
              seat >= proposal.players ? (
                <span
                  key={seat}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-border bg-muted text-muted-foreground"
                >
                  <Bot className="h-4 w-4" />
                </span>
              ) : seat < acceptedSeats ? (
                <span
                  key={seat}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <Check className="h-4 w-4" />
                </span>
              ) : (
                <CountdownRing
                  key={seat}
                  progress={progress}
                  className="h-10 w-10"
                  strokeWidth={6}
                />
              ),
            )}
          </div>
        )}

        {!waiting && choices.length > 1 && (
          <div className="mt-6 w-full space-y-3">
            <p className="text-ui-label text-muted-foreground">Choose your deck for this table</p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),10.5rem))] justify-center gap-3">
              {choices.map(({ deck, index }) => (
                <DeckSelectionCard
                  key={index}
                  name={deck.deck_name}
                  labels={deck.deck.labels}
                  cards={[...deck.deck.cards, ...(deck.deck.commanders ?? [])]}
                  cover={resolveCoverCard(deck.deck)}
                  isPreset={false}
                  isSelected={deckIndex === index}
                  dense
                  className="min-h-28"
                  isTouch={isTouch}
                  disabled={pending || remaining === 0}
                  onSelect={() => setSelection({ offer: invitation, index })}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-col items-center gap-2">
          {waiting ? (
            <p className="flex items-center gap-3 text-ui-body text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
              {phase === "joining" ? "Joining your table" : "Waiting for the other players"}
            </p>
          ) : (
            <>
              {inSolo && (
                <p className="mb-1 text-ui-label text-warning">Joining ends your solo game.</p>
              )}
              <Button
                variant="primary"
                size="lg"
                className="h-14 min-w-64 font-serif text-2xl"
                disabled={pending || remaining === 0 || deckIndex === undefined}
                onClick={() => deckIndex !== undefined && onAccept(deckIndex)}
              >
                {pending && <Loader2 className="animate-spin" />}
                Accept
              </Button>
              <Button variant="ghost" disabled={pending} onClick={onDecline}>
                {proposal ? "Decline" : "Keep searching"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CountdownRing({
  progress,
  className,
  strokeWidth = 3,
}: {
  progress: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg viewBox="0 0 100 100" className={cn("-rotate-90", className)}>
      <circle cx="50" cy="50" r={RING_RADIUS} className="fill-card stroke-border" strokeWidth="2" />
      <circle
        cx="50"
        cy="50"
        r={RING_RADIUS}
        fill="none"
        className="stroke-primary transition-[stroke-dashoffset] duration-300 ease-linear"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH * (1 - progress)}
      />
    </svg>
  );
}

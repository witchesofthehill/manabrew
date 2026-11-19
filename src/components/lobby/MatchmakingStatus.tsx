import { Loader2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MatchFoundDialog } from "@/components/lobby/MatchFoundDialog";
import { MatchmakingSearchDetails } from "@/components/lobby/MatchmakingSearchDetails";
import { localGameActive } from "@/lib/localGamePresence";
import { cn } from "@/lib/utils";
import { useGameStore } from "@/stores/useGameStore";
import { useMatchmakingStore } from "@/stores/useMatchmakingStore";
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

export function MatchmakingStatus({ floating = false }: { floating?: boolean }) {
  const state = useMatchmakingStore();
  const gameActive = useGameStore((s) => s.isGameActive);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { phase, proposal, tableCall, queuedAt, proposalExpiresAt, tableCallExpiresAt } = state;
  const active = phase !== "idle" && phase !== "matched";
  const invitation = proposal ?? tableCall;
  const expiresAt = proposal ? proposalExpiresAt : tableCallExpiresAt;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!active) return null;

  const elapsed = queuedAt ? Math.max(0, Math.floor((now - queuedAt) / 1000)) : 0;
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const hasOptions = !!state.offer || state.botFillOffer !== null;
  const label =
    phase === "preparing"
      ? "Checking decks"
      : phase === "joining"
        ? "Joining"
        : invitation
          ? "Match found"
          : `Searching · ${elapsedLabel}`;
  const title =
    phase === "preparing"
      ? "Checking your deck brackets"
      : phase === "joining"
        ? "Joining your table"
        : "Searching for a Commander game";

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
    <div
      ref={rootRef}
      className={cn(
        "relative shrink-0",
        floating &&
          "fixed top-[calc(var(--safe-area-inset-top)+0.75rem)] right-[calc(var(--safe-area-inset-right)+0.75rem)] z-50",
      )}
    >
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant={invitation ? "primary" : "outline"}
        className="relative tabular-nums"
        onClick={() => {
          if (state.offer) state.dismissOffer();
          setOpen((current) => !current);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="matchmaking-status"
      >
        {invitation ? <Users /> : <Loader2 className="animate-spin motion-reduce:animate-none" />}
        {label}
        {hasOptions && !open && (
          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
        )}
      </Button>
      <div
        id="matchmaking-status"
        role="dialog"
        aria-label={title}
        className={cn(
          "absolute top-full right-0 z-50 w-[22rem] max-w-[calc(100vw-2rem)] pt-2",
          (!open || invitation) && "hidden",
        )}
      >
        <div className="max-h-[70dvh] space-y-4 overflow-y-auto rounded-xl border border-border/70 bg-background/80 p-4 text-popover-foreground shadow-md backdrop-blur-md">
          <p className="flex items-center gap-2 text-ui-body font-semibold">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
            {title}
          </p>
          {phase === "queued" && <MatchmakingSearchDetails run={run} pending={pending} />}
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(state.leave)}>
              Cancel search
            </Button>
          </div>
        </div>
      </div>
      {invitation && expiresAt && (
        <MatchFoundDialog
          invitation={invitation}
          expiresAt={expiresAt}
          now={now}
          inSolo={gameActive && localGameActive()}
          pending={pending}
          onAccept={(deckIndex) => run(() => joinMatch(invitation, deckIndex))}
          onDecline={() =>
            run(() => (proposal ? state.declineMatch() : state.answerTableCall(false)))
          }
        />
      )}
    </div>
  );
}

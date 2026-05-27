import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { DraftingView } from "@/views/Draft";
import { submitHostPick, teardownHost } from "@/game/draftHost";
import { submitPeerPick } from "@/game/draftPeer";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import type { DraftCard } from "@/types/limited";

export default function MultiplayerDraft() {
  const navigate = useNavigate();
  const mode = useMultiplayerDraftStore((s) => s.mode);
  const amHost = useMultiplayerDraftStore((s) => s.amHost);
  const state = useMultiplayerDraftStore((s) => s.state);
  const seats = useMultiplayerDraftStore((s) => s.seats);
  const mySeat = useMultiplayerDraftStore((s) => s.mySeat);
  const finalPools = useMultiplayerDraftStore((s) => s.finalPools);
  const lastError = useMultiplayerDraftStore((s) => s.lastError);
  const clear = useMultiplayerDraftStore((s) => s.clear);
  const conspiracyHooks = useLimitedStore((s) => s.conspiracyHooks);
  const fetchConspiracyHooks = useLimitedStore((s) => s.fetchConspiracyHooks);

  useEffect(() => {
    if (conspiracyHooks.length === 0) fetchConspiracyHooks();
  }, [conspiracyHooks.length, fetchConspiracyHooks]);

  // Kick back to the lobby if the draft was never started or got
  // cleared mid-route (host disconnected, user landed on the URL
  // directly, etc.). Avoids a confusing empty render.
  useEffect(() => {
    if (mode === "idle") navigate("/lobby");
  }, [mode, navigate]);

  const handlePick = async (card: DraftCard) => {
    if (!state?.awaitingHuman) return;
    if (amHost) {
      await submitHostPick(card.name);
    } else {
      await submitPeerPick(card.name);
    }
  };

  if (mode === "idle") {
    return null;
  }

  if (mode === "complete") {
    const myPool = finalPools.find((p) => p.seat === mySeat);
    return (
      <CompletionView
        pools={finalPools}
        myPool={myPool?.pool ?? []}
        onExit={() => {
          if (amHost) teardownHost();
          clear();
          navigate("/lobby");
        }}
      />
    );
  }

  if (!state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Waiting for the host to deal the first pack…
      </div>
    );
  }

  const mySeatAssignment = seats.find((s) => s.seat === mySeat);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Multiplayer Draft</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              Round {state.round} / {state.totalRounds} · Pick {state.pickNumber}
            </span>
            {mySeatAssignment && (
              <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">
                Seat {mySeatAssignment.seat} · {mySeatAssignment.displayName}
              </span>
            )}
            {amHost && (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                Host
              </span>
            )}
            {state.isComplete ? (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                Complete
              </span>
            ) : state.awaitingHuman ? (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                Your pick
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium">
                <Loader2 className="h-3 w-3 animate-spin" />
                Waiting…
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/lobby")}>
          Back to lobby
        </Button>
      </header>

      <DraftingView
        activeDraft={state}
        onPick={handlePick}
        onJumpToBuild={() => {
          // Multiplayer build / sideboard phase is a follow-up PR.
          // Until then, "Build" is a no-op except as visual hint.
        }}
        canBuild={false}
        conspiracyHooks={conspiracyHooks}
      />

      {lastError && (
        <p className="rounded border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {lastError}
        </p>
      )}
    </div>
  );
}

interface CompletionViewProps {
  pools: ReturnType<typeof useMultiplayerDraftStore.getState>["finalPools"];
  myPool: DraftCard[];
  onExit: () => void;
}

function CompletionView({ pools, myPool, onExit }: CompletionViewProps) {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Draft complete · Build your deck</h1>
          <p className="text-sm text-muted-foreground">
            Drag from your picks into Main / Sideboard. Use "Save to My Decks" when you're happy
            with the 40 — saved decks open from the Decks view like any other.
          </p>
        </div>
        <Button variant="outline" onClick={onExit}>
          Exit
        </Button>
      </header>

      {myPool.length === 0 ? (
        // Observer / weren't seated — show the pod summary instead of
        // an empty builder so the user understands why they have no
        // cards to build with.
        <section>
          <p className="mb-3 text-sm text-muted-foreground">
            You weren't seated in this draft. Pod final pools:
          </p>
          <ul className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2 md:grid-cols-3">
            {pools.map((p) => (
              <li
                key={p.seat}
                className="flex items-center justify-between rounded border border-border/40 bg-card/30 px-3 py-2"
              >
                <span className={p.isHuman ? "font-semibold" : "text-muted-foreground"}>
                  {p.seat}. {p.displayName}
                </span>
                <span className="text-xs text-muted-foreground">{p.pool.length} cards</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="min-h-0 flex-1">
          <LimitedDeckBuilder
            pool={myPool}
            defaultDeckName="Multiplayer Draft Deck"
            format="draft"
          />
        </div>
      )}
    </div>
  );
}

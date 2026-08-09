import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTopBarOverride } from "@/components/layout/TopBarOverride";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { DraftStatusBar } from "@/components/limited/DraftStatusBar";
import { DraftWorkspace } from "@/components/limited/DraftWorkspace";
import { submitHostPick, teardownHost } from "@/game/draftHost";
import { submitPeerPick } from "@/game/draftPeer";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { useServerStore } from "@/stores/useServerStore";
import { ROUTES } from "@/lib/constants";
import {
  type MpDraftPlayerPool,
  useMultiplayerDraftStore,
} from "@/stores/useMultiplayerDraftStore";
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
  const pickPending = useMultiplayerDraftStore((s) => s.pickPending);
  const clear = useMultiplayerDraftStore((s) => s.clear);
  const conspiracyHooks = useLimitedStore((s) => s.conspiracyHooks);
  const fetchConspiracyHooks = useLimitedStore((s) => s.fetchConspiracyHooks);
  const leavingHome = useRef(false);

  useEffect(() => {
    if (conspiracyHooks.length === 0) fetchConspiracyHooks();
  }, [conspiracyHooks.length, fetchConspiracyHooks]);

  useEffect(() => {
    if (mode === "idle" && !leavingHome.current) navigate(ROUTES.LOBBY, { replace: true });
  }, [mode, navigate]);

  useEffect(() => {
    // Relies on StrictMode staying disabled in main.tsx — a dev double-mount
    // would run this cleanup mid-draft and tear down the live session.
    return () => {
      teardownHost(true);
      useMultiplayerDraftStore.getState().clear();
    };
  }, []);

  function leave(destination: string) {
    if (amHost) teardownHost(mode !== "complete");
    clear();
    navigate(destination);
  }

  async function leaveHome() {
    leavingHome.current = true;
    if (amHost) teardownHost(mode !== "complete");
    clear();
    await useServerStore.getState().leaveRoom();
    navigate(ROUTES.PLAY);
  }

  useTopBarOverride({
    title: mode === "complete" ? "Build Draft Deck" : undefined,
    onBack: () => leave(ROUTES.LOBBY),
    onHome: () => void leaveHome(),
    navigationDisabled: true,
  });

  const handlePick = async (card: DraftCard) => {
    if (!state?.awaitingHuman || pickPending) return;
    if (amHost) {
      await submitHostPick(card);
    } else {
      await submitPeerPick(card);
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
        onExit={() => leave(ROUTES.LOBBY)}
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
    <div className="flex h-full flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <DraftStatusBar
        draft={state}
        seatLabel={
          mySeatAssignment
            ? `Seat ${mySeatAssignment.seat} · ${mySeatAssignment.displayName}`
            : undefined
        }
        isHost={amHost}
        waitingLabel="Waiting for the pod…"
        viewerSeat={mySeat ?? undefined}
      />

      <DraftWorkspace
        draft={state}
        onPick={handlePick}
        conspiracyHooks={conspiracyHooks}
        pickPending={pickPending}
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
  pools: MpDraftPlayerPool[];
  myPool: DraftCard[];
  onExit: () => void;
}

function CompletionView({ pools, myPool, onExit }: CompletionViewProps) {
  return (
    <div className="flex h-full flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between gap-3">
        <div className="max-w-3xl">
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

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useTopBarOverride } from "@/components/layout/TopBarOverride";
import { DraftStatusBar } from "@/components/limited/DraftStatusBar";
import { DraftWorkspace } from "@/components/limited/DraftWorkspace";
import { LimitedTableSurface } from "@/components/limited/LimitedTableSurface";
import MultiplayerLimitedBuild from "@/views/MultiplayerLimitedBuild";
import { hasLiveDraftHost, submitHostPick, teardownHost } from "@/game/draftHost";
import { requestDraftResync, submitPeerPick } from "@/game/draftPeer";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { useServerStore } from "@/stores/useServerStore";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import { useMultiplayerLimitedStore } from "@/stores/useMultiplayerLimitedStore";
import { ROUTES } from "@/lib/constants";
import type { DraftCard } from "@/types/limited";

export default function MultiplayerDraft() {
  const navigate = useNavigate();
  const draft = useMultiplayerDraftStore();
  const phase = useMultiplayerLimitedStore((s) => s.phase);
  const kind = useMultiplayerLimitedStore((s) => s.kind);
  const conspiracyHooks = useLimitedStore((s) => s.conspiracyHooks);
  const fetchConspiracyHooks = useLimitedStore((s) => s.fetchConspiracyHooks);
  const roomBackground = useServerStore((state) => state.currentRoom?.table_style);
  const { mode, amHost, setError } = draft;
  useEffect(() => {
    if (conspiracyHooks.length === 0) fetchConspiracyHooks();
  }, [conspiracyHooks.length, fetchConspiracyHooks]);
  useEffect(() => {
    if (mode === "idle" && phase === "idle") navigate(ROUTES.LOBBY, { replace: true });
    else if (mode === "drafting" && !amHost) void requestDraftResync();
    else if (mode === "drafting" && amHost && !hasLiveDraftHost())
      setError("The host tab was reloaded. The draft engine is gone; this draft cannot resume.");
  }, [mode, amHost, setError, phase, navigate]);
  const leave = async (destination: string) => {
    if (draft.amHost) teardownHost(true);
    await useServerStore.getState().leaveRoom();
    navigate(destination);
  };
  useTopBarOverride({
    title: phase !== "idle" ? "Build draft deck" : undefined,
    onBack: () => void leave(ROUTES.LOBBY),
    onHome: () => void leave(ROUTES.PLAY),
    navigationDisabled: true,
  });
  const handlePick = async (card: DraftCard) => {
    if (!draft.state?.awaitingHuman || draft.pickPending || (draft.amHost && !hasLiveDraftHost()))
      return;
    if (draft.amHost) await submitHostPick(card);
    else await submitPeerPick(card);
  };
  if (kind === "draft" && phase !== "idle") return <MultiplayerLimitedBuild />;
  if (draft.mode === "idle") return null;
  if (!draft.state)
    return (
      <LimitedTableSurface
        backgroundId={roomBackground}
        className="items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Waiting for the host to deal your pack…
      </LimitedTableSurface>
    );
  const own = draft.seats.find((seat) => seat.seat === draft.mySeat);
  const room = useServerStore.getState().currentRoom;
  const hostDisconnected =
    room && !room.players.find((player) => player.username === room.host)?.connected;
  return (
    <LimitedTableSurface backgroundId={roomBackground} className="gap-2 px-4 py-3 sm:px-6 lg:px-8">
      <DraftStatusBar
        draft={draft.state}
        seatLabel={own ? `Seat ${own.seat} · ${own.displayName}` : undefined}
        isHost={draft.amHost}
        waitingLabel="Waiting for the pod…"
        viewerSeat={draft.mySeat ?? undefined}
      />
      <DraftWorkspace
        draft={draft.state}
        onPick={handlePick}
        conspiracyHooks={conspiracyHooks}
        pickPending={draft.pickPending}
      />
      {hostDisconnected && (
        <p role="status" className="text-sm text-destructive">
          The host is disconnected. Reconnect the same host tab to continue; reloading it loses the
          draft engine.
        </p>
      )}
      {draft.lastError && (
        <p role="alert" className="text-sm text-destructive">
          {draft.lastError}
        </p>
      )}
    </LimitedTableSurface>
  );
}

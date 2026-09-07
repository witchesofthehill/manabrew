import { warmArenaDeckImages } from "@/three/arenaImageCache";
import { getDeckCardPool } from "@/lib/decks";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useGameStore } from "@/stores/useGameStore";
import { useShallow } from "zustand/react/shallow";
import { useGameEventListeners } from "@/hooks/useGameEventListeners";
import { useFlashQueue } from "@/hooks/useFlashQueue";
import { useMultiplayerInterruption } from "@/hooks/useMultiplayerInterruption";
import { ForgeDuel } from "@/three/ForgeDuel";
import { DuelModal } from "@/three/DuelModal";
import type { DuelSession } from "@/three/useForgeDuel";
import type { GameViewDto, Prompt, PromptOutput } from "@manabrew/protocol";

function seatIds<T>(value: T, mapping: Map<string, string>): T {
  if (typeof value === "string") return (mapping.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((item) => seatIds(item, mapping)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        ["name", "text", "description", "label", "title"].includes(key)
          ? item
          : seatIds(item, mapping),
      ]),
    ) as T;
  return value;
}

export default function SharedArenaMatch() {
  useGameEventListeners();
  useFlashQueue(0);
  const interruption = useMultiplayerInterruption();
  const state = useGameStore(
    useShallow((s) => ({
      view: s.gameView,
      prompt: s.currentPrompt,
      slot: s.myPlayerSlot,
      active: s.isGameActive,
      waiting: s.isWaitingForResponse,
      error: s.fatalError,
      decks: s.gameDecks,
      multiplayer: s.isMultiplayer,
      host: s.isHost,
      conceded: s.selfConceded,
      respond: s.respond,
      end: s.endGame,
      concede: s.concede,
    })),
  );
  useEffect(() => {
    warmArenaDeckImages(
      Object.values(state.decks)
        .flatMap(getDeckCardPool)
        .map((card) => card.identity.name),
    );
  }, [state.decks]);
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const exit = state.multiplayer ? "/lobby" : "/play/offline/constructed";
  const session = useMemo<DuelSession>(() => {
    const ids = [
      state.slot,
      ...(state.view?.players.map((p) => p.id).filter((id) => id !== state.slot) ?? []),
    ].filter((id): id is string => !!id);
    const mapping = new Map(ids.map((id, i) => [id, `player-${i}`]));
    const inverse = new Map([...mapping].map(([a, b]) => [b, a]));
    const view = seatIds(state.view, mapping) as GameViewDto | null;
    if (view && state.conceded)
      view.players = view.players.map((p) =>
        p.id === "player-0" ? { ...p, status: "conceded" } : p,
      );
    return {
      view,
      prompt:
        state.waiting || state.conceded || interruption.waiting
          ? null
          : (seatIds(state.prompt, mapping) as Prompt | null),
      error: state.error ?? "",
      deckName: state.decks[state.slot ?? ""]?.name ?? "Your deck",
      playerColors: Object.fromEntries(
        ids.map((id) => [
          mapping.get(id)!,
          [...new Set((state.decks[id]?.cards ?? []).flatMap((card) => card.color.split("")))],
        ]),
      ),
      respond: async (id, action) => {
        const current = useGameStore.getState();
        if (current.isWaitingForResponse || String(current.currentPrompt?.promptId) !== String(id))
          return;
        const output = seatIds(action, inverse) as PromptOutput;
        await current.respond(output.output);
      },
      concede: () => {
        void state.concede();
      },
      restart: () => {
        void state.end().then(() => navigate(exit));
      },
    };
  }, [state, interruption.waiting, navigate, exit]);
  if (!state.active) return <Navigate to={exit} replace />;
  if (!session.view)
    return (
      <div className="p-6 text-foreground" role="status">
        {state.error || "Preparing your battlefield…"}
      </div>
    );
  return (
    <>
      <ForgeDuel session={session} onExit={() => setLeaving(true)} />
      {interruption.waiting && (
        <div
          className="absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-border bg-background px-4 py-3 text-foreground"
          role="status"
        >
          Waiting for reconnection
          {interruption.secondsLeft == null ? "" : ` · ${interruption.secondsLeft}s`}
        </div>
      )}
      {leaving && (
        <DuelModal title="Leave match" onClose={() => setLeaving(false)}>
          <h2>Leave match?</h2>
          <p>
            {state.multiplayer && state.host
              ? "You are hosting. Leaving ends this match for the other players."
              : "Return to match setup?"}
          </p>
          <button onClick={() => setLeaving(false)}>Stay in match</button>
          <button onClick={() => void state.end().then(() => navigate(exit))}>Leave match</button>
        </DuelModal>
      )}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { LimitedPackOpening } from "@/components/limited/LimitedPackOpening";
import { LimitedTableSurface } from "@/components/limited/LimitedTableSurface";
import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { useMultiplayerLimitedStore } from "@/stores/useMultiplayerLimitedStore";
import { useServerStore } from "@/stores/useServerStore";
import { useGameStore } from "@/stores/useGameStore";
import {
  completeLimitedMatch,
  completeLimitedOpening,
  limitedGameLaunch,
  requestLimitedResync,
  setLimitedBestOf,
  startLimitedMatches,
  submitLimitedBuild,
} from "@/game/limitedSession";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import type { DraftCard } from "@/types/limited";

export default function MultiplayerLimitedBuild() {
  const navigate = useNavigate();
  const session = useMultiplayerLimitedStore();
  const server = useServerStore();
  const [starting, setStarting] = useState(false);
  const gameActive = useGameStore((s) => s.isGameActive);
  const [returning, setReturning] = useState(false);
  const returnAttempted = useRef(false);
  const returnToBuild = useCallback(async () => {
    setReturning(true);
    try {
      await completeLimitedMatch();
    } catch (error) {
      useMultiplayerLimitedStore.getState().setError(String(error));
    } finally {
      setReturning(false);
    }
  }, []);
  const onChange = useCallback(
    ({ main, sideboard }: { main: DraftCard[]; sideboard: DraftCard[] }) => {
      void submitLimitedBuild(main, sideboard).catch((error) =>
        useMultiplayerLimitedStore.getState().setError(String(error)),
      );
    },
    [],
  );
  const onConfirm = useCallback(
    async ({ main, sideboard }: { main: DraftCard[]; sideboard: DraftCard[] }) => {
      try {
        await submitLimitedBuild(main, sideboard, true);
      } catch (error) {
        useMultiplayerLimitedStore.getState().setError(String(error));
      }
    },
    [],
  );
  useEffect(() => {
    if (!server.gameStarted || !session.matchReturn) return;
    const launch = limitedGameLaunch({
      room_id: server.gameRoomId,
      game_id: server.gameId,
      player_order: server.playerOrder,
      player_decks: server.playerDecks,
      starting_life: server.startingLife,
    });
    if (launch) navigate(ROUTES.PLAY, { replace: true, state: launch });
  }, [
    navigate,
    server.gameStarted,
    server.gameRoomId,
    server.gameId,
    server.playerOrder,
    server.playerDecks,
    server.startingLife,
    session.matchReturn,
  ]);
  useEffect(() => {
    if (session.phase !== "playing" && !session.matchReturn)
      void requestLimitedResync().catch((error) =>
        useMultiplayerLimitedStore.getState().setError(String(error)),
      );
  }, [session.sessionId, session.phase, session.matchReturn]);
  useEffect(() => {
    if (
      !session.matchReturn?.started ||
      gameActive ||
      returnAttempted.current ||
      server.gameStarted
    )
      return;
    returnAttempted.current = true;
    void returnToBuild();
  }, [session.matchReturn, gameActive, server.gameStarted, returnToBuild]);
  if (!session.sessionId || !session.originalRoom) return null;
  const amHost = session.originalRoom.host === server.username;
  const ownStatus = session.statuses.find((status) => status.seat === session.mySeat);
  const unfinishedSeats = session.series
    .filter((match) => !match.complete)
    .flatMap((match) => match.seats);
  const allReady =
    session.statuses.length === session.seats.length &&
    session.statuses.every(
      (status) =>
        !status.playing &&
        ((unfinishedSeats.length > 0 && !unfinishedSeats.includes(status.seat)) || status.ready),
    );
  const hostDisconnected =
    server.currentRoom?.room_id === session.originalRoom.room_id &&
    !server.currentRoom.players.find((player) => player.username === session.originalRoom!.host)
      ?.connected;
  const start = async () => {
    setStarting(true);
    try {
      await startLimitedMatches();
    } catch (error) {
      session.setError(String(error));
    } finally {
      setStarting(false);
    }
  };
  if (session.matchReturn?.started && !gameActive)
    return (
      <section className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p role="status" className="text-sm text-muted-foreground">
          {returning
            ? "Returning to your Limited pool…"
            : "Your pool and build are retained. Confirm your return with the relay to continue."}
        </p>
        {session.lastError && (
          <p role="alert" className="text-sm text-destructive">
            {session.lastError}
          </p>
        )}
        <Button variant="primary" disabled={returning} onClick={() => void returnToBuild()}>
          Retry return to pool
        </Button>
      </section>
    );
  if (session.phase === "opening" && session.sealed)
    return (
      <LimitedTableSurface
        backgroundId={session.originalRoom.table_style}
        className="px-4 py-3 sm:px-6 lg:px-8"
      >
        <LimitedPackOpening
          key={session.sessionId}
          sessionKey={session.sessionId}
          packs={session.sealed.packs}
          onComplete={() => void completeLimitedOpening()}
        />
      </LimitedTableSurface>
    );
  return (
    <LimitedTableSurface
      backgroundId={session.originalRoom.table_style}
      className="gap-2 px-4 py-3 sm:px-6 lg:px-8"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="rounded bg-card/70 px-2 py-1 text-xs text-muted-foreground">
          Your pool stays here after each game. Edit your deck, then ready for a casual pairing.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void requestLimitedResync().catch((error) => session.setError(String(error)))
            }
          >
            Sync with host
          </Button>
          {amHost && (
            <AppSelect
              value={String(session.bestOf)}
              onValueChange={(value) =>
                void setLimitedBestOf(value === "1" ? 1 : 3).catch((error) =>
                  session.setError(String(error)),
                )
              }
              aria-label="Match length"
              disabled={
                session.statuses.some((status) => status.playing) ||
                session.series.some(
                  (match) => !match.complete && match.wins.some((wins) => wins > 0),
                )
              }
            >
              <AppSelectOption value="1">Single game</AppSelectOption>
              <AppSelectOption value="3">Best of three</AppSelectOption>
            </AppSelect>
          )}
          {amHost && (
            <Button
              variant="primary"
              disabled={!allReady || starting || session.phase === "playing"}
              onClick={() => void start()}
            >
              {starting ? "Pairing…" : "Play paired games"}
            </Button>
          )}
        </div>
      </header>
      <ul className="flex shrink-0 flex-wrap gap-2 text-sm" aria-label="Deck readiness">
        {session.seats.map((seat) => {
          const status = session.statuses.find((s) => s.seat === seat.seat);
          return (
            <li
              key={seat.seat}
              className={cn(
                "rounded-md bg-card/80 px-2 py-1",
                status?.ready ? "text-selection" : "text-muted-foreground",
              )}
            >
              <span className="font-semibold">{seat.displayName}</span> ·{" "}
              {status?.playing
                ? "Playing"
                : status?.ready
                  ? "Deck ready"
                  : session.kind === "sealed" && !status?.opened
                    ? "Opening packs"
                    : "Building"}
            </li>
          );
        })}
      </ul>
      {session.series.length > 0 && (
        <ul
          className="flex flex-wrap gap-3 text-sm text-muted-foreground"
          aria-label="Casual match scores"
        >
          {session.series.map((match) => (
            <li key={match.seats.join("-")} className="rounded bg-card/70 px-2 py-1">
              {match.seats
                .map((id) => session.seats.find((seat) => seat.seat === id)?.displayName)
                .join(" / ")}{" "}
              · {match.wins.join(" - ")}
              {match.complete ? " · Match complete" : " · Sideboard between games"}
            </li>
          ))}
        </ul>
      )}
      {hostDisconnected && (
        <p role="status" className="text-sm text-destructive">
          The host is disconnected. Wait for the same tab to reconnect. A closed or reloaded host
          tab cannot restore this session.
        </p>
      )}
      {session.lastError && (
        <p role="alert" className="text-sm text-destructive">
          {session.lastError}
        </p>
      )}
      {session.phase === "playing" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Starting your paired game…
        </p>
      ) : (
        <div className="min-h-0 flex-1">
          <LimitedDeckBuilder
            key={session.sessionId}
            sessionKey={session.sessionId}
            pool={session.pool}
            initialMain={session.build?.main}
            initialSideboard={session.build?.sideboard}
            defaultDeckName={`Multiplayer ${session.kind}`}
            format={session.kind ?? "draft"}
            requireCompleteToSave
            onChange={onChange}
            onConfirm={onConfirm}
            confirmLabel={ownStatus?.ready ? "Deck ready" : "Ready deck"}
          />
        </div>
      )}
    </LimitedTableSurface>
  );
}

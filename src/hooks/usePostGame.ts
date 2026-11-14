import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Deck } from "@/protocol/deck";
import { postGameStatus } from "@/game/postGameStatus";
import { useMultiplayerRematch } from "@/hooks/useMultiplayerRematch";
import { useGameStore } from "@/stores/useGameStore";
import { useServerStore } from "@/stores/useServerStore";
import { RELAY_FEATURE, type PlayerDeckInfo } from "@/types/server";

const EMPTY_PLAYER_STATUSES: Readonly<Record<string, string>> = {};

export function usePostGame(completed: boolean, managedReturn: boolean) {
  const navigate = useNavigate();
  const singlePlayerSetup = useGameStore((state) => state.singlePlayerSetup);
  const isMultiplayer = useGameStore((state) => state.isMultiplayer);
  const engineCrash = useGameStore((state) => state.engineCrash);
  const room = useServerStore((state) => state.currentRoom);
  const username = useServerStore((state) => state.username);
  const connected = useServerStore((state) => state.connected);
  const playerOrder = useServerStore((state) => state.playerOrder);
  const supportsRematch = useServerStore((state) =>
    state.hasRelayFeature(RELAY_FEATURE.GameRematch),
  );
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const [previousDeck, setPreviousDeck] = useState<PlayerDeckInfo | undefined>(() =>
    useServerStore.getState().playerDecks.find((player) => player.username === username),
  );
  const multiplayer = isMultiplayer && !singlePlayerSetup;
  useMultiplayerRematch(completed && multiplayer && !managedReturn);
  const status = useMemo(
    () => postGameStatus(room, username, playerOrder, connected),
    [room, username, playerOrder, connected],
  );
  const run = (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    void action()
      .catch((failure: unknown) => {
        const message =
          failure instanceof Error ? failure.message : "Could not prepare the next game.";
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        pending.current = false;
        setBusy(false);
      });
  };
  const canChoose =
    completed &&
    !engineCrash &&
    !managedReturn &&
    (singlePlayerSetup ||
      (multiplayer &&
        connected &&
        supportsRematch &&
        room?.status === "Finished" &&
        room.rematch?.players.some((player) => player.username === username)));
  const onPlayAgain =
    canChoose && (!multiplayer || !room?.rematch?.cancelled)
      ? () =>
          run(async () => {
            if (singlePlayerSetup) {
              const started = await useGameStore.getState().restartGame();
              if (!started) throw new Error("The next game could not be started.");
            } else {
              await useServerStore.getState().setRematchIntent(status.ready ? "Deciding" : "Ready");
            }
          })
      : null;
  const onChangeDeck = canChoose
    ? () =>
        run(async () => {
          if (singlePlayerSetup) {
            await useGameStore.getState().endGame();
            navigate("/play/offline/constructed", {
              replace: true,
              state: { singlePlayerSetup },
            });
          } else if (room?.rematch?.cancelled) {
            await useServerStore.getState().returnToLobby();
          } else {
            await useServerStore.getState().setRematchIntent("ChoosingDeck");
            setDeckPickerOpen(true);
          }
        })
    : null;
  const onHome = () =>
    run(async () => {
      await useGameStore.getState().endGame();
      useGameStore.setState({ singlePlayerSetup: null });
      navigate("/play", { replace: true });
    });
  const onPickerOpenChange = (open: boolean) => {
    setDeckPickerOpen(open);
    if (!open && useServerStore.getState().currentRoom?.status === "Finished") {
      void useServerStore
        .getState()
        .setRematchIntent("Deciding")
        .catch((failure: unknown) => {
          toast.error(
            failure instanceof Error ? failure.message : "Could not cancel deck selection.",
          );
        });
    }
  };
  const onDeckSelected = (
    deck: Deck,
    _formatId: string,
    commanderName?: string,
    _playerCount?: number,
    publishedDeckId?: string,
  ) =>
    run(async () => {
      const server = useServerStore.getState();
      await server.setDeckSelection(deck.name, deck, commanderName, publishedDeckId);
      setPreviousDeck({
        username: server.username ?? "",
        deck_name: deck.name,
        deck,
        commander_name: commanderName,
        published_deck_id: publishedDeckId,
      });
      await server.setRematchIntent("Ready");
    });
  return {
    busy,
    ready: multiplayer && status.ready,
    playerStatuses: multiplayer ? status.playerStatuses : EMPTY_PLAYER_STATUSES,
    statusMessage:
      error ??
      (managedReturn ? "Returning to your session…" : multiplayer ? status.statusMessage : null),
    onPlayAgain,
    onChangeDeck,
    onHome,
    deckPickerOpen,
    onPickerOpenChange,
    onDeckSelected,
    previousDeck,
    room,
  };
}

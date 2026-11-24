import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getPlatform } from "@/platform";
import type { SpawnAiBotParams } from "@/platform/types";
import { peekSpawnedBots } from "@/lib/spawnedBots";
import { stripUsernameTag } from "@/lib/username";
import { useServerStore } from "@/stores/useServerStore";
import type { BotFailedPayload, PlayerDeckInfo, RoomInfo, RoomUpdatePayload } from "@/types/server";
import type { Deck } from "@/protocol/deck";

interface LobbyDeckSelectionOptions {
  room: RoomInfo | null;
  username: string | null;
  onSelectPlayerDeck: (
    deck: Deck,
    commanderName?: string,
    publishedDeckId?: string,
  ) => Promise<void>;
}

export function useLobbyDeckSelection({
  room,
  username,
  onSelectPlayerDeck,
}: LobbyDeckSelectionOptions) {
  const [target, setTarget] = useState<{ roomId: string; username: string } | null>(null);
  const [owned, setOwned] = useState<{ roomId: string; names: string[] } | null>(null);
  const [assigned, setAssigned] = useState<Record<string, PlayerDeckInfo>>({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const pending = useRef(false);
  const cancelSelection = useRef<(() => void) | null>(null);
  const playerDecks = useServerStore((state) => state.playerDecks);
  const roomId = room?.room_id;
  const roomStatus = room?.status;
  const ownedBots = owned && owned.roomId === roomId ? owned.names : [];
  const persistedBots = roomId ? peekSpawnedBots(roomId) : [];
  const selectedUsername =
    target &&
    target.roomId === roomId &&
    (target.username === username || ownedBots.includes(target.username))
      ? target.username
      : username;
  const selectedPlayer = room?.players.find((player) => player.username === selectedUsername);
  const persistedBot = persistedBots.find((bot) => bot.username === selectedUsername);
  const previousDeck = playerDecks.find(
    (entry) =>
      entry.username === selectedUsername && entry.deck_name === selectedPlayer?.selected_deck_name,
  );
  const knownDeck =
    assigned[`${roomId}:${selectedUsername}`] ??
    (persistedBot?.deck && persistedBot.deckName
      ? {
          username: persistedBot.username,
          deck_name: persistedBot.deckName,
          deck: persistedBot.deck,
          commander_name: persistedBot.commanderName ?? undefined,
          published_deck_id: persistedBot.publishedDeckId,
        }
      : previousDeck);
  const selectedDeck =
    knownDeck?.deck_name === selectedPlayer?.selected_deck_name ? knownDeck : previousDeck;
  const pickerOpen =
    open &&
    roomStatus === "Lobby" &&
    target !== null &&
    target.roomId === roomId &&
    target.username === selectedUsername;

  useEffect(() => {
    setOpen(false);
    return () => cancelSelection.current?.();
  }, [roomId, room?.format, roomStatus]);

  useEffect(() => {
    if (!roomId || roomStatus !== "Lobby") return;
    let active = true;
    void getPlatform()
      .server?.restoreAiBots(roomId)
      .then((names) => {
        if (active) setOwned({ roomId, names });
      })
      .catch((error: unknown) => {
        if (active)
          toast.error(error instanceof Error ? error.message : "Couldn't restore table bots.");
      });
    return () => {
      active = false;
    };
  }, [roomId, roomStatus]);

  useEffect(
    () =>
      getPlatform().events.on<BotFailedPayload>("server:bot_failed", (payload) => {
        setOwned((current) =>
          current
            ? {
                ...current,
                names: current.names.filter((name) => name !== payload.username),
              }
            : current,
        );
        toast.error(`Bot couldn't join the table: ${payload.reason}`);
      }),
    [],
  );

  function selectSeat(seatUsername: string) {
    if (!room || room.status !== "Lobby" || pending.current) return;
    if (seatUsername !== username && !ownedBots.includes(seatUsername)) return;
    setTarget({ roomId: room.room_id, username: seatUsername });
    setOpen(true);
  }

  async function spawnBot(params: SpawnAiBotParams) {
    await getPlatform().server!.spawnAiBot(params);
    if (useServerStore.getState().currentRoom?.room_id !== params.roomId) return;
    setOwned((currentOwned) => ({
      roomId: params.roomId,
      names: [
        ...new Set([
          ...(currentOwned?.roomId === params.roomId ? currentOwned.names : []),
          params.username,
        ]),
      ],
    }));
  }

  async function addBot(seatIndex: number) {
    const server = getPlatform().server;
    const current = useServerStore.getState().currentRoom;
    if (
      !server ||
      !current ||
      current.room_id !== roomId ||
      current.status !== "Lobby" ||
      !username ||
      pending.current
    )
      return;
    const controller = current.players.find((player) => !player.is_bot)?.username;
    const joining = ownedBots.filter(
      (name) => !current.players.some((player) => player.username === name),
    );
    if (
      controller !== username ||
      current.draft_config ||
      current.sealed_config ||
      ["Any", "Draft", "Sealed"].includes(current.format) ||
      current.players.length + joining.length >= current.max_players ||
      seatIndex >= current.max_players ||
      current.players.some((player, index) => (player.seat_index ?? index) === seatIndex)
    )
      return;
    const botName = `${stripUsernameTag(username)}-bot-${crypto.randomUUID().slice(0, 8)}`;
    pending.current = true;
    setBusy(true);
    try {
      await spawnBot({
        roomId: current.room_id,
        username: botName,
        roomPassword: useServerStore.getState().roomPassword,
        seatIndex,
      });
      const latest = useServerStore.getState().currentRoom;
      if (latest?.room_id !== current.room_id) return;
      if (latest.status !== "Lobby" || latest.format !== current.format) return;
      setTarget({ roomId: current.room_id, username: botName });
      setOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add a bot.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function removeBot(botName: string) {
    if (!ownedBots.includes(botName) || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await getPlatform().server!.removeAiBot(botName);
      setOwned({ roomId: roomId!, names: ownedBots.filter((name) => name !== botName) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove the bot.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function selectDeck(deck: Deck, commanderName?: string, publishedDeckId?: string) {
    const current = useServerStore.getState().currentRoom;
    if (
      !current ||
      current.room_id !== roomId ||
      current.status !== "Lobby" ||
      !selectedUsername ||
      pending.current ||
      (selectedUsername !== username && !ownedBots.includes(selectedUsername))
    ) {
      throw new Error("This seat is no longer available for deck selection.");
    }
    pending.current = true;
    setBusy(true);
    try {
      await new Promise<void>((resolve, reject) => {
        const isBot = selectedUsername !== username;
        let sawSelection = false;
        const unsubscribe = getPlatform().events.on<RoomUpdatePayload>(
          "server:room_update",
          ({ room: updatedRoom }) => {
            if (updatedRoom.room_id !== roomId) return;
            if (updatedRoom.status !== "Lobby") {
              finish(new Error("The table is no longer in the lobby."));
              return;
            }
            const player = updatedRoom.players.find((entry) => entry.username === selectedUsername);
            if (player?.selected_deck_name !== deck.name) return;
            if (!player.ready) sawSelection = true;
            if (sawSelection && (!isBot || player.ready)) finish();
          },
        );
        const timer = setTimeout(
          () => finish(new Error("The relay did not confirm this deck selection.")),
          10_000,
        );
        function finish(error?: unknown) {
          clearTimeout(timer);
          unsubscribe();
          cancelSelection.current = null;
          if (error) reject(error);
          else resolve();
        }
        cancelSelection.current = () =>
          finish(new Error("The table changed during deck selection."));
        const selection =
          selectedUsername === username
            ? onSelectPlayerDeck(deck, commanderName, publishedDeckId)
            : getPlatform().server!.setAiBotDeck(selectedUsername, {
                deckName: deck.name,
                deck,
                commanderName: commanderName ?? null,
                publishedDeckId,
              });
        void selection.catch(finish);
      });
      setAssigned((currentAssigned) => ({
        ...currentAssigned,
        [`${roomId}:${selectedUsername}`]: {
          username: selectedUsername,
          deck_name: deck.name,
          deck,
          commander_name: commanderName,
          published_deck_id: publishedDeckId,
        },
      }));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return {
    selectedUsername,
    open: pickerOpen,
    setOpen,
    selectedDeck,
    selectSeat,
    selectDeck,
    addBot,
    spawnBot,
    removeBot,
    ownedBots,
    busy,
  };
}

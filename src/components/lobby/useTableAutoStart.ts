import { useEffect, useRef } from "react";
import { createRoomRelayEnvelope, SELF_HOSTED_NODE_RELAY_PROTOCOL } from "@/game/roomRelay";
import {
  tableController,
  tableIsReady,
  tableStartsAutomatically,
} from "@/components/lobby/tables.utils";
import { getPlatform } from "@/platform";
import type { Deck } from "@/protocol/deck";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import type { RoomInfo } from "@/types/server";

interface BotDeck {
  name: string;
  deck: Deck;
  commanderName?: string;
}

interface TableAutoStartParams {
  room: RoomInfo | null;
  username: string | null;
  spawnBot(botName: string, deck: BotDeck): Promise<void>;
  start(): Promise<void>;
}

export function useTableAutoStart({ room, username, spawnBot, start }: TableAutoStartParams) {
  const presets = usePresetDecks("Forge");
  const filledRoom = useRef<string | null>(null);
  const startedRoom = useRef<string | null>(null);

  useEffect(() => {
    if (!room || room.status !== "Lobby" || !tableStartsAutomatically(room)) {
      startedRoom.current = null;
      return;
    }
    if (tableController(room) !== username) return;
    const commanderPresets = presets.filter(
      (deck) => deck.format === "commander" && (deck.commanders?.length ?? 0) > 0,
    );
    if (
      room.matchmade_bot_fill &&
      filledRoom.current !== room.room_id &&
      commanderPresets.length > 0
    ) {
      filledRoom.current = room.room_id;
      const decks = Array.from({ length: room.max_players - room.players.length }, () => {
        const deck = commanderPresets[Math.floor(Math.random() * commanderPresets.length)];
        return { name: deck.name, deck, commanderName: deck.commanders?.[0]?.identity.name };
      });
      if (room.hosted) {
        void getPlatform().server?.sendRoomMessage(
          createRoomRelayEnvelope({
            protocol: SELF_HOSTED_NODE_RELAY_PROTOCOL,
            roomId: room.room_id,
            payload: {
              type: "spawnBot",
              decks: decks.map((deck) => ({
                deckName: deck.name,
                deck: deck.deck,
                commanderName: deck.commanderName ?? null,
              })),
              forgeAi: false,
            },
          }),
        );
      } else {
        const stamp = Date.now().toString(36);
        decks.forEach((deck, index) => void spawnBot(`Manabot-${stamp}-${index}`, deck));
      }
    }
    if (tableIsReady(room) && startedRoom.current !== room.room_id) {
      startedRoom.current = room.room_id;
      void start();
    }
  }, [presets, room, spawnBot, start, username]);
}

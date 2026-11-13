import { useEffect, useRef } from "react";
import type { Deck } from "@/protocol/deck";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import type { RoomInfo } from "@/types/server";

interface BotDeck {
  name: string;
  deck: Deck;
  commanderName?: string;
}

interface MatchmadeHostParams {
  room: RoomInfo | null;
  username: string | null;
  spawnBot(botName: string, deck: BotDeck): Promise<void>;
  start(): Promise<void>;
}

export function useMatchmadeHost({ room, username, spawnBot, start }: MatchmadeHostParams) {
  const presets = usePresetDecks("Forge");
  const filledRoom = useRef<string | null>(null);
  const startedRoom = useRef<string | null>(null);

  useEffect(() => {
    if (!room?.matchmade_bracket || room.host !== username || room.status !== "Lobby") return;
    const commanderPresets = presets.filter(
      (deck) => deck.format === "commander" && (deck.commanders?.length ?? 0) > 0,
    );
    if (filledRoom.current !== room.room_id && commanderPresets.length > 0) {
      filledRoom.current = room.room_id;
      const stamp = Date.now().toString(36);
      for (let seat = room.players.length; seat < room.max_players; seat += 1) {
        const deck = commanderPresets[Math.floor(Math.random() * commanderPresets.length)];
        void spawnBot(`Manabot-${stamp}-${seat}`, {
          name: deck.name,
          deck,
          commanderName: deck.commanders?.[0]?.identity.name,
        });
      }
    }
    const full = room.players.length === room.max_players;
    const ready = room.players.every((player) => player.username === username || player.ready);
    if (full && ready && startedRoom.current !== room.room_id) {
      startedRoom.current = room.room_id;
      void start();
    }
  }, [presets, room, spawnBot, start, username]);
}

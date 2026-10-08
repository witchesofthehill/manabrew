import { getPlatform } from "@/platform";
import { LIMITED_SESSION_PROTOCOL } from "@/game/limitedSession";
import type { RoomRelayEnvelope } from "@/types/server";

interface LimitedResultAckInput {
  sessionId: string;
  gameId: string;
  roomId: string;
  host: string;
  username: string;
  send: () => Promise<void>;
}

export async function awaitLimitedResultAck({
  sessionId,
  gameId,
  roomId,
  host,
  username,
  send,
}: LimitedResultAckInput): Promise<void> {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  const timeout = setTimeout(() => {
    off();
    reject(
      new Error(
        "The original host has not confirmed saving this result. Your result is kept on this device; reconnect and retry.",
      ),
    );
  }, 10000);
  const off = getPlatform().events.on<{
    from_player: string;
    state: RoomRelayEnvelope<{ type: string; sessionId: string; gameId: string }>;
  }>("server:room_message", (event) => {
    const env = event.state;
    if (
      event.from_player !== host ||
      env.fromPlayer !== host ||
      env.protocol !== LIMITED_SESSION_PROTOCOL ||
      env.roomId !== roomId ||
      env.targetPlayer !== username ||
      env.payload.type !== "resultAck" ||
      env.payload.sessionId !== sessionId ||
      env.payload.gameId !== gameId
    )
      return;
    clearTimeout(timeout);
    off();
    resolve();
  });
  try {
    await send();
    await promise;
  } finally {
    clearTimeout(timeout);
    off();
  }
}

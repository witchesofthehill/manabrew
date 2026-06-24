import type { ManualTabletopAction, ManualTabletopApi } from "./runtime.types";
import { BroadcastRoomHost } from "./roomHost";
import type { RoomHostEnvelope } from "./roomHost";
import type { GameViewDto } from "@/protocol/game";

let activeRoomHost: BroadcastRoomHost | null = null;
let activeUnsubscribe: (() => void) | null = null;

export interface ManualRoomSyncOptions {
  roomHost: BroadcastRoomHost;
  api: ManualTabletopApi;
}

export function startManualRoomSync({ roomHost, api }: ManualRoomSyncOptions): void {
  stopManualRoomSync();
  activeRoomHost = roomHost;
  activeUnsubscribe = roomHost.subscribe((envelope) => {
    void handleRoomHostEnvelope(api, roomHost, envelope);
  });
}

export function stopManualRoomSync(): void {
  activeUnsubscribe?.();
  activeUnsubscribe = null;
  activeRoomHost = null;
}

export function getActiveManualRoomHost(): BroadcastRoomHost | null {
  return activeRoomHost;
}

export async function applyManualTabletopAction(
  api: ManualTabletopApi,
  action: ManualTabletopAction,
): Promise<GameViewDto | null> {
  const roomHost = activeRoomHost;
  if (!roomHost) {
    return api.applyManualAction(action);
  }

  if (roomHost.mode === "authoritative-host") {
    const gameView = await api.applyManualAction(action);
    await roomHost.broadcastManualState(gameView);
    return gameView;
  } else {
    await roomHost.broadcastManualAction(action);
    return null;
  }
}

async function handleRoomHostEnvelope(
  api: ManualTabletopApi,
  roomHost: BroadcastRoomHost,
  envelope: RoomHostEnvelope,
): Promise<void> {
  switch (envelope.payload.type) {
    case "manualState":
      await api.applyManualAction({
        type: "replaceState",
        gameView: envelope.payload.gameView,
      });
      break;
    case "manualAction":
      if (roomHost.mode !== "authoritative-host") return;
      {
        const gameView = await api.applyManualAction(envelope.payload.action);
        await roomHost.broadcastManualState(gameView);
      }
      break;
  }
}

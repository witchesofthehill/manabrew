import { getPlatform } from "@/platform";
import type { GameViewDto } from "@/protocol/game";
import type { ManualTabletopAction, SeatController } from "./runtime.types";
import {
  MANUAL_TABLETOP_RELAY_PROTOCOL,
  createRoomRelayEnvelope,
  isRoomRelayProtocol,
} from "./roomRelay";
import type { RoomRelayEnvelope, RoomMessagePayload } from "@/types/server";

export type RoomHostMode = "authoritative-host" | "relay-client";

export type RoomHostPayload =
  | {
      type: "manualState";
      mode: RoomHostMode;
      gameView: GameViewDto;
    }
  | {
      type: "manualAction";
      mode: RoomHostMode;
      action: ManualTabletopAction;
    };

export type RoomHostEnvelope = RoomRelayEnvelope<RoomHostPayload> & {
  protocol: typeof MANUAL_TABLETOP_RELAY_PROTOCOL;
  fromPlayer: string;
};

export interface BroadcastRoomHostConfig {
  localPlayerSlot: string;
  mode: RoomHostMode;
  seats: SeatController[];
}

export class BroadcastRoomHost {
  readonly localPlayerSlot: string;
  readonly mode: RoomHostMode;
  readonly seats: SeatController[];

  constructor(config: BroadcastRoomHostConfig) {
    this.localPlayerSlot = config.localPlayerSlot;
    this.mode = config.mode;
    this.seats = config.seats;
  }

  async broadcastManualState(gameView: GameViewDto): Promise<void> {
    await this.broadcast({
      type: "manualState",
      mode: this.mode,
      gameView,
    });
  }

  async broadcastManualAction(action: ManualTabletopAction): Promise<void> {
    await this.broadcast({
      type: "manualAction",
      mode: this.mode,
      action,
    });
  }

  subscribe(handler: (envelope: RoomHostEnvelope) => void): () => void {
    return getPlatform().events.on<RoomMessagePayload<RoomHostPayload>>(
      "server:room_message",
      (payload) => {
        const envelope = payload.state;
        if (!isRoomHostEnvelope(envelope)) return;
        if (envelope.fromPlayer === this.localPlayerSlot) return;
        handler(envelope);
      },
    );
  }

  private async broadcast(payload: RoomHostPayload): Promise<void> {
    const server = getPlatform().server;
    if (!server) {
      throw new Error("Room hosting requires a server connection.");
    }
    await server.sendRoomMessage(
      createRoomRelayEnvelope({
        protocol: MANUAL_TABLETOP_RELAY_PROTOCOL,
        fromPlayer: this.localPlayerSlot,
        payload,
      }),
    );
  }
}

export function isRoomHostEnvelope(value: unknown): value is RoomHostEnvelope {
  if (!isRoomRelayProtocol<RoomHostPayload>(value, MANUAL_TABLETOP_RELAY_PROTOCOL)) return false;
  const candidate = value as Partial<RoomHostEnvelope>;
  const payload = candidate.payload as Partial<RoomHostPayload> | undefined;
  return (
    typeof candidate.fromPlayer === "string" &&
    !!payload &&
    typeof payload === "object" &&
    (payload.type === "manualState" || payload.type === "manualAction") &&
    (payload.mode === "authoritative-host" || payload.mode === "relay-client")
  );
}
